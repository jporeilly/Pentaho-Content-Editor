"""What a model's JSON actually looks like, and what must survive it.

Split out of test_editor.py because every case here is a literal string
a local model really emitted, and they are full of backslashes and
quotes: keeping them away from the fixtures keeps both readable.

The bug these exist for: the AI review panel showed a wall of raw JSON
instead of findings. One finding in twelve quoted a Windows path with an
unescaped backslash, `json.loads` rejected the whole document, and the
editor fell back to printing the model's answer at the author - losing
every anchor, mark, jump and Apply button the review had earned. All
twelve, for one character.
"""

from routers.ai import parse_findings

BS = chr(92)   # built, not typed: this file is about backslashes


def test_a_clean_answer_parses():
    out = parse_findings(
        '[{"severity": "critical", "quote": "Start Spoon", '
        '"issue": "no version given", "fix": "name it"}]'
    )
    assert len(out) == 1 and out[0].severity == "critical"


def test_one_unescaped_backslash_no_longer_costs_the_whole_review():
    # The actual failure, reduced: a lone backslash inside a quoted
    # Windows path. "\0" is not a JSON escape, so strict parsing throws.
    answer = (
        '[{"severity": "critical", "quote": "the folder", "issue": "ambiguous", "fix": "be clear"},'
        ' {"severity": "nice", "quote": "", "issue": "open 02-see-it-work' + BS + '01-your-first-win", "fix": "say what to do"},'
        ' {"severity": "should", "quote": "Re-run checks", "issue": "unclear", "fix": "clarify"}]'
    )
    out = parse_findings(answer)
    assert len(out) == 3, "a malformed finding must cost only itself"
    # And the path survives intact - repairing the escape must not
    # rewrite what the reviewer said.
    assert "02-see-it-work" + BS + "01-your-first-win" in out[1].issue


def test_a_trailing_comma_is_tolerated():
    out = parse_findings('[{"issue": "one"}, {"issue": "two"},]')
    assert [f.issue for f in out] == ["one", "two"]


def test_a_finding_too_broken_to_read_is_skipped_not_fatal():
    # An unterminated string in the middle: that object is unreadable,
    # the ones around it are not.
    answer = (
        '[{"issue": "first"},'
        ' {"issue": "second, with a quote that never closes},'
        ' {"issue": "third"}]'
    )
    out = parse_findings(answer)
    issues = [f.issue for f in out]
    assert "first" in issues and "third" in issues


def test_prose_is_still_prose():
    # No JSON at all: the caller falls back to showing the raw answer,
    # which is the correct behaviour and must not be mistaken for
    # findings.
    assert parse_findings("**Critical** - the lab has no prerequisites.") == []
    assert parse_findings("") == []


def test_the_fenced_shape_models_prefer():
    out = parse_findings(
        "Here is what I found:\n\n```json\n"
        '[{"severity": "Major", "quote": "x", "issue": "y", "fix": "z"}]\n'
        "```\n\nHope that helps."
    )
    assert len(out) == 1 and out[0].severity == "critical"
