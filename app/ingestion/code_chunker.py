import tree_sitter
import tree_sitter_python
from typing import Dict, List, Any

# Load the Python grammar for Tree-sitter
PY_LANGUAGE = tree_sitter.Language(tree_sitter_python.language())


class PythonCodeChunker:
    """
    A robust, production-ready utility class to parse Python source code into 
    semantic chunks (classes, functions, methods). 
    
    This enables Retrieval-Augmented Generation (RAG) applications to index 
    meaningful units of code rather than arbitrary text splits, significantly 
    improving search accuracy and LLM context understanding.
    """
    def __init__(self):
        """
        Initializes the Tree-sitter parser with the Python language grammar.
        """
        self.parser = tree_sitter.Parser(PY_LANGUAGE)

    def chunk_code(self, source_code: str, file_path: str = "unknown.py") -> List[Dict[str, Any]]:
        """
        Parses the given Python source code and extracts classes, functions, and methods.

        :param source_code: The raw Python source code as a string.
        :param file_path: The path of the file being parsed (useful for metadata).
        :return: A list of dictionaries representing the extracted chunks.
        """
        # Convert the string to bytes as Tree-sitter expects byte-encoded input
        source_bytes = source_code.encode("utf-8")
        
        # Generate the Abstract Syntax Tree (AST)
        tree = self.parser.parse(source_bytes)
        
        # Traverse the tree and collect the semantic chunks
        chunks = self._traverse_tree(tree.root_node, file_path)
        return chunks

    def _traverse_tree(self, node: tree_sitter.Node, file_path: str) -> List[Dict[str, Any]]:
        """
        Recursively traverses the Abstract Syntax Tree (AST) to find and extract relevant code blocks.

        :param node: The current AST node being examined.
        :param file_path: The file path to attach to the chunk metadata.
        :return: A list of chunk dictionaries discovered from this node downwards.
        """
        chunks = []
        
        # Check if the current node represents a class definition
        if node.type == "class_definition":
            chunks.append(self._extract_chunk_metadata(node, "class", file_path))
            
        # Check if the current node represents a function or method definition
        elif node.type == "function_definition":
            chunk_type = "function"
            
            # Determine if this function is actually a method by checking its ancestors
            # If it is nested inside a class_definition, it is classified as a method.
            parent = node.parent
            while parent:
                if parent.type == "class_definition":
                    chunk_type = "method"
                    break
                parent = parent.parent
                
            chunks.append(self._extract_chunk_metadata(node, chunk_type, file_path))

        # Recursively search through all children of this node to catch nested definitions
        for child in node.children:
            chunks.extend(self._traverse_tree(child, file_path))
            
        return chunks

    def _extract_chunk_metadata(self, node: tree_sitter.Node, chunk_type: str, file_path: str) -> Dict[str, Any]:
        """
        Extracts the necessary metadata and content from a matched syntax node.

        :param node: The matched tree-sitter node.
        :param chunk_type: The determined type of the chunk ("class", "function", "method").
        :param file_path: The associated file path.
        :return: A formatted dictionary matching the required output schema.
        """
        # Safely extract the name identifier of the class or function
        name_node = node.child_by_field_name("name")
        name = name_node.text.decode("utf-8") if name_node and name_node.text else "Unknown"
        
        # Extract the full source code block of this node
        content = node.text.decode("utf-8") if node.text else ""
        
        # Tree-sitter uses 0-indexed rows, so we add 1 for standard 1-indexed line numbering
        start_line = node.start_point[0] + 1
        end_line = node.end_point[0] + 1
        
        return {
            "file_path": file_path,
            "chunk_type": chunk_type,
            "name": name,
            "content": content,
            "start_line": start_line,
            "end_line": end_line
        }
