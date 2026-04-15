"""Unit tests for agent helper functions and shared logic."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.agent import (
    _read_mermaid_syntax_impl,
    _read_mermaid_config_impl,
    _clean_markdown,
    _resolve_schema_refs,
    _parse_follow_ups,
    _load_config_schema,
    AgentDeps,
    _build_user_prompt,
)


# ── _clean_markdown ──────────────────────────────────────────────


class TestCleanMarkdown:
    def test_strips_preamble(self):
        text = "---\nfrontmatter\n---\n# Title\nBody"
        assert _clean_markdown(text) == "# Title\nBody"

    def test_no_heading_returns_original(self):
        text = "No heading here\nJust content"
        assert _clean_markdown(text) == text

    def test_only_heading(self):
        text = "# Just a heading"
        assert _clean_markdown(text) == "# Just a heading"


# ── _resolve_schema_refs ─────────────────────────────────────────


class TestResolveSchemaRefs:
    def test_resolves_simple_ref(self):
        schema = {"$defs": {"Color": {"type": "string", "enum": ["red", "blue"]}}}
        obj = {"$ref": "#/$defs/Color"}
        result = _resolve_schema_refs(schema, obj)
        assert result == {"type": "string", "enum": ["red", "blue"]}

    def test_preserves_non_ref(self):
        schema = {"$defs": {}}
        obj = {"type": "string", "description": "hello"}
        result = _resolve_schema_refs(schema, obj)
        assert result == obj

    def test_handles_list(self):
        schema = {"$defs": {"Item": {"type": "number"}}}
        obj = [{"$ref": "#/$defs/Item"}, {"type": "string"}]
        result = _resolve_schema_refs(schema, obj)
        assert result == [{"type": "number"}, {"type": "string"}]

    def test_depth_limit(self):
        schema = {"$defs": {"Loop": {"$ref": "#/$defs/Loop"}}}
        obj = {"$ref": "#/$defs/Loop"}
        result = _resolve_schema_refs(schema, obj, depth=4)
        assert "$ref" in result

    def test_handles_primitives(self):
        schema = {}
        assert _resolve_schema_refs(schema, 42) == 42
        assert _resolve_schema_refs(schema, "hello") == "hello"
        assert _resolve_schema_refs(schema, None) is None
        assert _resolve_schema_refs(schema, True) is True


# ── _parse_follow_ups ────────────────────────────────────────────


class TestParseFollowUps:
    def test_basic_extraction(self):
        text = "Created a flowchart.\n\n>> Add more nodes\n>> Change colors"
        explanation, follow_ups = _parse_follow_ups(text)
        assert explanation == "Created a flowchart."
        assert follow_ups == ["Add more nodes", "Change colors"]

    def test_no_follow_ups(self):
        text = "Just an explanation with no suggestions."
        explanation, follow_ups = _parse_follow_ups(text)
        assert explanation == text
        assert follow_ups == []

    def test_empty_text(self):
        explanation, follow_ups = _parse_follow_ups("")
        assert explanation == ""
        assert follow_ups == []

    def test_only_follow_ups(self):
        text = ">> First\n>> Second"
        explanation, follow_ups = _parse_follow_ups(text)
        assert explanation == ""
        assert follow_ups == ["First", "Second"]

    def test_blank_lines_between(self):
        text = "Explanation here.\n\n\n>> Suggestion one\n>> Suggestion two\n"
        explanation, follow_ups = _parse_follow_ups(text)
        assert explanation == "Explanation here."
        assert follow_ups == ["Suggestion one", "Suggestion two"]


# ── user prompt formatting ────────────────────────────────────────


class TestBuildUserPrompt:
    def test_contains_delimited_code_and_request_blocks(self):
        prompt = _build_user_prompt(
            user_message="Improve layout",
            chart_type="flowchart",
            current_mermaid_code="flowchart TD\nA-->B",
        )
        assert "=== CHART_TYPE_START ===" in prompt
        assert "=== CURRENT_MERMAID_CODE_START ===" in prompt
        assert "=== CURRENT_MERMAID_CODE_END ===" in prompt
        assert "=== USER_REQUEST_START ===" in prompt
        assert "=== USER_REQUEST_END ===" in prompt


# ── _read_mermaid_syntax_impl ────────────────────────────────────


class TestReadMermaidSyntax:
    def test_known_diagram_type(self):
        result = _read_mermaid_syntax_impl("sankey")
        assert "Documentation for" not in result
        assert result.strip() != ""

    def test_unknown_diagram_type(self):
        result = _read_mermaid_syntax_impl("non_existent_diagram")
        assert "Documentation for 'non_existent_diagram' not found" in result

    def test_flowchart_has_content(self):
        result = _read_mermaid_syntax_impl("flowchart")
        assert len(result) > 100


# ── _read_mermaid_config_impl ────────────────────────────────────


class TestReadMermaidConfig:
    def test_summary_mode(self):
        result = _read_mermaid_config_impl(None)
        assert "Configuration schema not found" not in result
        assert "Top-level" in result or "properties" in result.lower()

    def test_known_property(self):
        result = _read_mermaid_config_impl("flowchart")
        assert "Property 'flowchart' not found" not in result
        parsed = json.loads(result)
        assert "flowchart" in parsed

    def test_unknown_property(self):
        result = _read_mermaid_config_impl("non_existent_property")
        assert "Property 'non_existent_property' not found" in result


# ── _load_config_schema (caching) ────────────────────────────────


class TestConfigCaching:
    def test_returns_dict_on_success(self):
        schema = _load_config_schema()
        assert schema is not None
        assert isinstance(schema, dict)
        assert "properties" in schema

    def test_subsequent_calls_return_same_object(self):
        a = _load_config_schema()
        b = _load_config_schema()
        assert a is b


# ── AgentDeps ────────────────────────────────────────────────────


class TestAgentDeps:
    def test_resolve_tool_sets_result(self):
        ws = MagicMock()
        deps = AgentDeps(ws=ws)

        loop = asyncio.new_event_loop()
        future = loop.create_future()
        deps.pending_tools["test-id"] = future

        deps.resolve_tool("test-id", {"image": "base64data"})
        assert future.done()
        assert future.result() == {"image": "base64data"}
        loop.close()

    def test_resolve_unknown_tool_is_noop(self):
        ws = MagicMock()
        deps = AgentDeps(ws=ws)
        deps.resolve_tool("nonexistent", {"data": "value"})

    @pytest.mark.asyncio
    async def test_request_client_tool_timeout(self):
        ws = AsyncMock()
        deps = AgentDeps(ws=ws)

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                deps.request_client_tool("test_tool", {}),
                timeout=0.1,
            )

    @pytest.mark.asyncio
    async def test_request_client_tool_success(self):
        ws = AsyncMock()
        deps = AgentDeps(ws=ws)

        async def resolve_after_delay():
            await asyncio.sleep(0.05)
            tool_id = list(deps.pending_tools.keys())[0]
            deps.resolve_tool(tool_id, {"image": "ok"})

        task = asyncio.create_task(resolve_after_delay())
        result = await deps.request_client_tool("render", {"code": "graph TD"})
        assert result == {"image": "ok"}
        await task

    @pytest.mark.asyncio
    async def test_request_client_tool_cleans_up_on_timeout(self):
        ws = AsyncMock()
        deps = AgentDeps(ws=ws)

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                deps.request_client_tool("test_tool", {}),
                timeout=0.05,
            )

        assert len(deps.pending_tools) == 0
