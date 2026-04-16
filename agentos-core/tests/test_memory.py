def test_add_and_count(memory):
    assert memory.count() == 0
    memory.add("The capital of France is Paris.", meta={"source": "test"})
    memory.add("Binary search runs in O(log n).")
    assert memory.count() == 2


def test_search_returns_match(memory):
    memory.add("The capital of France is Paris.")
    memory.add("The Eiffel Tower is in Paris.")
    memory.add("Unrelated sentence about bananas.")
    hits = memory.search("Paris", k=5)
    assert len(hits) >= 2
    assert all("paris" in h["text"].lower() for h in hits[:2])


def test_search_empty_query(memory):
    memory.add("anything")
    assert memory.search("", k=3) == []


def test_meta_roundtrip(memory):
    memory.add("hello", meta={"tag": "greeting", "n": 1})
    hits = memory.search("hello", k=1)
    assert hits[0]["meta"] == {"tag": "greeting", "n": 1}
