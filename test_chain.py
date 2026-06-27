from app.rag.chain import RAGChain
try:
    chain = RAGChain()
    print("Init successful.")
    # We will test formatting the prompt
    messages = chain._messages("How does this work?", "def foo(): pass", {}, "explanation")
    print("Messages formatting successful.")
except Exception as e:
    import traceback
    traceback.print_exc()
