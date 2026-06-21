import logging
import os
import re
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
        Recursively fetches all supported code files from the given GitHub repository.
        Uses depth-first traversal to avoid recursion limits in large repositories.
        
        :param repo_url: The GitHub repository URL.
        :return: A dictionary containing 'code_files' and 'metadata_files'.
        """
        owner, repo_name = self.parse_github_url(repo_url)
        full_name = f"{owner}/{repo_name}"
        logger.info(f"Connecting to GitHub repository: {full_name}")
        
        try:
            repo = self.github_client.get_repo(full_name)
        except GithubException as e:
            error_msg = e.data.get("message", str(e)) if hasattr(e, "data") and isinstance(e.data, dict) else str(e)
            raise ValueError(f"Could not access repository {full_name}. Ensure it exists and is accessible. Error: {error_msg}")

        extracted_code = []
        extracted_metadata = []
        
        # Iterative depth-first traversal using a stack
        contents_stack = repo.get_contents("")
        if not isinstance(contents_stack, list):
            contents_stack = [contents_stack]

        while contents_stack:
            file_content = contents_stack.pop()
            
            if file_content.type == "dir":
                # Immediately bypass blacklisted directories to save GitHub API calls
                if file_content.name in IGNORE_DIRS:
                    logger.info(f"Skipping ignored directory: {file_content.path}")
                    continue
                    
                # Fetch directory contents and add to the traversal stack
                dir_contents = repo.get_contents(file_content.path)
                if isinstance(dir_contents, list):
                    contents_stack.extend(dir_contents)
                else:
                    contents_stack.append(dir_contents)
            
            elif file_content.type == "file":
                filename_lower = file_content.name.lower()
                _, ext = os.path.splitext(file_content.name)
                
                is_code = ext.lower() in SUPPORTED_EXTENSIONS
                is_metadata = filename_lower in METADATA_FILES
                
                if is_code or is_metadata:
                    try:
                        # decoded_content returns None for files >1MB (GitHub API limitation for large blobs)
                        raw = file_content.decoded_content
                        if raw is None:
                            logger.warning(f"Skipping {file_content.path}: file too large, GitHub API returned no inline content.")
                            continue
                        content = raw.decode("utf-8", errors="ignore")
                        
                        file_obj = {
                            "path": file_content.path,
                            "content": content,
                            "score": self._score_file(file_content.path)
                        }
                        
                        if is_code:
                            extracted_code.append(file_obj)
                        if is_metadata:
                            extracted_metadata.append(file_obj)
                            
                        logger.info(f"Fetched: {file_content.path} (Score: {file_obj['score']})")
                    except Exception as e:
                        logger.warning(f"Skipping {file_content.path}: could not decode content. Error: {e}")

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
