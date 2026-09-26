"""Embedder T6: workers-ai + nvidia + local (spec §7).

Real client code over httpx.MockTransport (fake transport, no
secrets). Batch ≤32, 10 s timeout, 502 on 5xx/timeout, 503 on
missing creds, non-bge-m3 model id refused at selection.
"""

from __future__ import annotations

import httpx
import pytest

from app.retrieval import embeddings
from app.retrieval.embeddings import (
    EmbedMisconfigured,
    EmbedUnreachable,
)


def _vec1024(seed: float = 0.1) -> list[float]:
    return [seed] * 1024


def test_workers_ai_posts_bge_m3_and_parses_embeddings():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = request.content.decode()
        import json

        payload = json.loads(request.content.decode())
        assert payload["text"] == ["hello", "world"]
        return httpx.Response(
            200,
            json={"result": {"data": [
                {"embedding": _vec1024(0.1)},
                {"embedding": _vec1024(0.2)},
            ]}},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    p = embeddings.WorkersAiProvider(
        account_id="acct", api_token="tok", client=client
    )
    assert p.dims == 1024
    vecs = p.embed(["hello", "world"])
    assert "@cf/baai/bge-m3" in seen["url"]
    assert len(vecs) == 2 and len(vecs[0]) == 1024


def test_workers_ai_batches_at_32():
    counts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        payload = json.loads(request.content.decode())
        counts.append(len(payload["text"]))
        return httpx.Response(
            200,
            json={"result": {"data": [
                {"embedding": _vec1024()} for _ in payload["text"]
            ]}},
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    p = embeddings.WorkersAiProvider(
        account_id="a", api_token="t", client=client
    )
    vecs = p.embed([f"t{i}" for i in range(33)])
    assert counts == [32, 1]
    assert len(vecs) == 33


def test_workers_ai_5xx_is_unreachable():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    p = embeddings.WorkersAiProvider(
        account_id="a", api_token="t", client=client
    )
    with pytest.raises(EmbedUnreachable):
        p.embed(["hi"])


def test_workers_ai_missing_creds_is_misconfigured():
    with pytest.raises(EmbedMisconfigured):
        embeddings.WorkersAiProvider(account_id="", api_token="")
    with pytest.raises(EmbedMisconfigured):
        embeddings.WorkersAiProvider(account_id="a", api_token=None)


def test_nvidia_posts_openai_compat_shape():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        import json

        payload = json.loads(request.content.decode())
        assert payload["model"] == "baai/bge-m3"
        assert payload["input"] == ["hello"]
        return httpx.Response(
            200, json={"data": [{"embedding": _vec1024(0.3)}]}
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    p = embeddings.NvidiaProvider(api_key="k", client=client)
    vecs = p.embed(["hello"])
    assert "/v1/embeddings" in seen["url"]
    assert len(vecs[0]) == 1024


def test_nvidia_rejects_non_bge_m3_model_id():
    with pytest.raises(EmbedMisconfigured):
        embeddings.NvidiaProvider(api_key="k", model="other-model")


def test_nvidia_missing_key_is_misconfigured():
    with pytest.raises(EmbedMisconfigured):
        embeddings.NvidiaProvider(api_key="")


def test_local_refuses_wrong_model_id():
    with pytest.raises(EmbedMisconfigured):
        embeddings.LocalProvider(model="sentence-transformers/all-MiniLM-L6-v2")


def test_local_names_exact_bge_m3_weights():
    p = embeddings.LocalProvider()
    assert p.model == "BAAI/bge-m3"
    assert p.dims == 1024


def test_selection_is_explicit_with_no_chain():
    hash_p = embeddings.select_provider("hash")
    assert hash_p.name == "hash"
    with pytest.raises(EmbedMisconfigured):
        embeddings.select_provider("workers-ai", account_id="", api_token="")
    with pytest.raises(EmbedMisconfigured):
        embeddings.select_provider("nope")
