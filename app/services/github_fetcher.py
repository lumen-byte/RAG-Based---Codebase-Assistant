import logging
import os
import re
from typing import Dict, List

from github import Github, GithubException

logger = logging.getLogger(__name__)

# Extensions corresponding to code files typical in modern codebases
SUPPORTED_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx",
    ".java", ".cpp", ".c", ".go", ".rs"
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

    def fetch_code_files(self, repo_url: str) -> List[Dict[str, str]]:
        """
        Recursively fetches all supported code files from the given GitHub repository.
        Uses depth-first traversal to avoid recursion limits in large repositories.
        
        :param repo_url: The GitHub repository URL.
        :return: A list of dictionaries containing 'path' and 'content' of the files.
        """
        owner, repo_name = self.parse_github_url(repo_url)
        full_name = f"{owner}/{repo_name}"
        logger.info(f"Connecting to GitHub repository: {full_name}")
        
        try:
            repo = self.github_client.get_repo(full_name)
        except GithubException as e:
            error_msg = e.data.get("message", str(e)) if hasattr(e, "data") and isinstance(e.data, dict) else str(e)
            raise ValueError(f"Could not access repository {full_name}. Ensure it exists and is accessible. Error: {error_msg}")

        extracted_files = []
        
        # Iterative depth-first traversal using a stack
        contents_stack = repo.get_contents("")
        if not isinstance(contents_stack, list):
            contents_stack = [contents_stack]

        while contents_stack:
            file_content = contents_stack.pop()
            
            if file_content.type == "dir":
                # Fetch directory contents and add to the traversal stack
                dir_contents = repo.get_contents(file_content.path)
                if isinstance(dir_contents, list):
                    contents_stack.extend(dir_contents)
                else:
                    contents_stack.append(dir_contents)
            
            elif file_content.type == "file":
                _, ext = os.path.splitext(file_content.name)
                # Filter strictly by supported programming language extensions
                if ext.lower() in SUPPORTED_EXTENSIONS:
                    try:
                        # decoded_content returns None for files >1MB (GitHub API limitation for large blobs)
                        raw = file_content.decoded_content
                        if raw is None:
                            logger.warning(f"Skipping {file_content.path}: file too large, GitHub API returned no inline content.")
                            continue
                        content = raw.decode("utf-8", errors="ignore")
                        extracted_files.append({
                            "path": file_content.path,
                            "content": content
                        })
                        logger.info(f"Fetched: {file_content.path}")
                    except Exception as e:
                        logger.warning(f"Skipping {file_content.path}: could not decode content. Error: {e}")

        logger.info(f"Total files fetched from {full_name}: {len(extracted_files)}")
        return extracted_files
