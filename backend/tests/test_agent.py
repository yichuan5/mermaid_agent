from app.services.agent import _read_mermaid_syntax_impl, _read_mermaid_config_impl


def test_read_mermaid_syntax_success():
    result = _read_mermaid_syntax_impl("sankey")
    assert "Documentation for" not in result
    assert result.strip() != ""


def test_read_mermaid_syntax_not_found():
    result = _read_mermaid_syntax_impl("non_existent_diagram")
    assert "Documentation for 'non_existent_diagram' not found" in result


def test_read_mermaid_config_success():
    summary_result = _read_mermaid_config_impl(None)
    assert summary_result is not None
    assert "Configuration schema not found" not in summary_result

    prop_result = _read_mermaid_config_impl("flowchart")
    assert prop_result is not None
    assert "Property 'flowchart' not found" not in prop_result


def test_read_mermaid_config_not_found():
    result = _read_mermaid_config_impl("non_existent_property")
    assert "Property 'non_existent_property' not found" in result
