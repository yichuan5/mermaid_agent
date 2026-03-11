from app.services.agent import read_mermaid_syntax, read_mermaid_config


def test_read_mermaid_syntax_success():
    # sankey should exist since it's one of the diagram types
    result = read_mermaid_syntax(None, "sankey")
    assert "Documentation for" not in result
    assert result.strip() != ""


def test_read_mermaid_syntax_not_found():
    result = read_mermaid_syntax(None, "non_existent_diagram")
    assert "Documentation for 'non_existent_diagram' not found" in result


def test_read_mermaid_config_success():
    # test reading the config summary
    summary_result = read_mermaid_config(None)
    assert summary_result is not None
    assert "Configuration schema not found" not in summary_result

    # test reading specific valid property
    prop_result = read_mermaid_config(None, "flowchart")
    assert prop_result is not None
    assert "Property 'flowchart' not found" not in prop_result


def test_read_mermaid_config_not_found():
    result = read_mermaid_config(None, "non_existent_property")
    assert "Property 'non_existent_property' not found" in result
