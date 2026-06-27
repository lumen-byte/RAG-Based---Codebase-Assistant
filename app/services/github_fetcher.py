import logging
import os
import re
import tempfile
import zipfile
import requests
from typing import Dict, List, Any

from github import Github, GithubException

from app.config import MAX_FILES_TO_INDEX

logger = logging.getLogger(__name__)

# Extensions corresponding to code files typical in modern codebases
SUPPORTED_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx",
    ".java", ".cpp", ".c", ".go", ".rs"
}

# Key configuration files used for Repository Intelligence
METADATA_FILES = {
    "readme.md", "package.json", "requirements.txt", "pyproject.toml",
    "dockerfile", "docker-compose.yml", ".env.example", "pom.xml"
}

# Directories that should NEVER be crawled to save API limits
IGNORE_DIRS = {
    "node_modules", "dist", "build", ".next", "venv", ".venv", "env",
    "migrations", "__pycache__", ".git", ".idea", ".vscode", "coverage"
}

class GithubFetcher:
    """
    A utility class to fetch and process code files from public or private GitHub repositories.
    """
    def __init__(self, token: str | None = None):
        """
        Initialize the GithubFetcher.
        :param token: Optional GitHub personal access token to avoid rate limits.
                      Falls back to the GITHUB_TOKEN environment variable.
        """
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.github_client = Github(self.token) if self.token else Github()

    def parse_github_url(self, url: str) -> tuple[str, str]:
        """
        Extract the owner and repository name from a GitHub URL.
        :param url: The GitHub repository URL (e.g., https://github.com/owner/repo)
        :return: A tuple of (owner, repo_name)
        """
        # Clean up the URL format — Pydantic HttpUrl may add a trailing slash
        url = url.rstrip("/").removesuffix(".git")
        
        match = re.search(r"github\.com/([^/]+)/([^/]+)", url)
        if not match:
            raise ValueError("Invalid GitHub URL format. Expected format: https://github.com/owner/repo")
            
        return match.group(1), match.group(2)

    def validate_repo_exists(self, repo_url: str) -> bool:
        """
        Validates if the GitHub repository exists and is accessible.
        """
        try:
            owner, repo_name = self.parse_github_url(repo_url)
            full_name = f"{owner}/{repo_name}"
            self.github_client.get_repo(full_name)
            return True
        except Exception:
            return False

    def _score_file(self, path: str) -> int:
        """
        Scores a file based on its path to prioritize high-value architectural files.
        """
        score = 0
        lower_path = path.lower()
        
        # High priority: Core app logic, routes, and models
        if ("main.py" in lower_path or "app.py" in lower_path or "index.js" in lower_path or
            "/routes/" in lower_path or "/auth/" in lower_path or 
            "/services/" in lower_path or "/controllers/" in lower_path or 
            "/models/" in lower_path or "/api/" in lower_path):
            score += 100
            
        # Medium priority: Utilities and config
        elif "/helpers/" in lower_path or "/utils/" in lower_path or "/config/" in lower_path:
            score += 50
            
        # Low priority: Tests and docs
        elif "/tests/" in lower_path or "/examples/" in lower_path or "/docs/" in lower_path:
            score += 10
            
        # Default code file
        else:
            score += 20
            
        return score

    def fetch_code_files(self, repo_url: str) -> Dict[str, Any]:
        """
        Fetches all supported code files from the given GitHub repository.
        Uses the GitHub /zipball endpoint to download the entire repository
        as a ZIP archive streamed to disk, making it extremely fast and memory-safe.
        
        :param repo_url: The GitHub repository URL.
        :return: A dictionary containing 'code_files' and 'metadata_files'.
        """
        owner, repo_name = self.parse_github_url(repo_url)
        logger.info(f"Connecting to GitHub repository: {owner}/{repo_name}")
        
        # Prepare API headers
        headers = {}
        if self.token:
            headers["Authorization"] = f"token {self.token}"
            
        # Get the default branch (usually main or master) using PyGithub to ensure we get the right zip
        try:
            repo = self.github_client.get_repo(f"{owner}/{repo_name}")
            default_branch = repo.default_branch
        except GithubException as e:
            error_msg = e.data.get("message", str(e)) if hasattr(e, "data") and isinstance(e.data, dict) else str(e)
            raise ValueError(f"Could not access repository {owner}/{repo_name}. Ensure it exists and is accessible. Error: {error_msg}")

        # Construct the zipball URL
        zip_url = f"https://api.github.com/repos/{owner}/{repo_name}/zipball/{default_branch}"
        logger.info(f"Downloading ZIP archive from: {zip_url}")

        extracted_code = []
        extracted_metadata = []
        
        # Stream the ZIP download to a temporary file on disk to prevent RAM OOM crashes
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp_file:
            tmp_path = tmp_file.name
            try:
                with requests.get(zip_url, headers=headers, stream=True) as response:
                    response.raise_for_status()
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            tmp_file.write(chunk)
            except Exception as e:
                os.remove(tmp_path)
                raise ValueError(f"Failed to download repository archive: {e}")

        logger.info("ZIP download complete. Processing files...")

        try:
            with zipfile.ZipFile(tmp_path) as z:
                for file_info in z.infolist():
                    # Skip directories
                    if file_info.is_dir():
                        continue
                        
                    # Skip files larger than 1MB to save memory and avoid processing massive compiled binaries
                    if file_info.file_size > 1024 * 1024:
                        continue

                    # The first directory in the path is the root folder created by GitHub (e.g. owner-repo-commitHash)
                    # We strip it out to get the true relative path in the repo
                    parts = file_info.filename.split('/', 1)
                    if len(parts) < 2:
                        continue
                    relative_path = parts[1]
                    
                    # Immediately bypass blacklisted directories
                    if any(ignored in relative_path.split('/') for ignored in IGNORE_DIRS):
                        continue
                        
                    filename_lower = os.path.basename(relative_path).lower()
                    _, ext = os.path.splitext(relative_path)
                    
                    is_code = ext.lower() in SUPPORTED_EXTENSIONS
                    is_metadata = filename_lower in METADATA_FILES
                    
                    if is_code or is_metadata:
                        try:
                            # Read file content from the zip
                            content_bytes = z.read(file_info)
                            content = content_bytes.decode("utf-8")
                            
                            file_obj = {
                                "path": relative_path,
                                "content": content,
                                "score": self._score_file(relative_path)
                            }
                            
                            if is_code:
                                extracted_code.append(file_obj)
                            if is_metadata:
                                extracted_metadata.append(file_obj)
                                
                        except UnicodeDecodeError:
                            # Ignore files that are not valid UTF-8 (e.g., binaries that sneak through)
                            pass
                        except Exception as e:
                            logger.warning(f"Skipping {relative_path}: {e}")
        finally:
            # Clean up the temporary file from disk immediately after processing
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        total_files_found = len(extracted_code)
        
        # Sort extracted code descending by score
        extracted_code.sort(key=lambda x: x["score"], reverse=True)
        
        # Slice to the top N files
        indexed_code = extracted_code[:MAX_FILES_TO_INDEX]
        files_ignored = max(0, total_files_found - MAX_FILES_TO_INDEX)
        
        logger.info(f"Total code files found: {total_files_found}")
        logger.info(f"Files ignored due to limit: {files_ignored}")
        logger.info(f"Files kept for indexing: {len(indexed_code)}")
        logger.info(f"Total metadata files fetched: {len(extracted_metadata)}")
        
        return {
            "code_files": indexed_code,
            "metadata_files": extracted_metadata,
            "total_files_found": total_files_found,
            "files_ignored": files_ignored,
            "files_indexed": len(indexed_code)
        }
