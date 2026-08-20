#!/usr/bin/env python3
"""
validate_chapter.py — run against any generated chapter JSON before registering it.
Catches the two bug classes already found in this project:
  1. is_image_based: true with no [Image: ...] tag in the question (and vice versa)
  2. correct_answer not matching any string in options exactly
Also does basic structural sanity checks.
Usage: python3 validate_chapter.py <path-to-chapter.json>
"""
import json, sys

def validate(path):
    with open(path) as f:
        ch = json.load(f)

    errors = []
    warnings = []

    mcqs = ch.get('mcqs', [])
    if not mcqs:
        errors.append("No mcqs array found or it's empty.")

    ids_seen = set()
    for m in mcqs:
        mid = m.get('id', '<no id>')

        if mid in ids_seen:
            errors.append(f"{mid}: duplicate MCQ id within this file.")
        ids_seen.add(mid)

        # Bug class 1: is_image_based / [Image: tag mismatch
        has_tag = '[Image:' in m.get('question', '')
        flagged = m.get('is_image_based', False)
        if flagged and not has_tag:
            errors.append(f"{mid}: is_image_based=True but no [Image:...] tag in question text.")
        if has_tag and not flagged:
            errors.append(f"{mid}: question has [Image:...] tag but is_image_based=False.")
        if flagged and not m.get('image_ref'):
            errors.append(f"{mid}: is_image_based=True but image_ref is missing/null.")

        # Bug class 2: correct_answer must match an option exactly
        opts = m.get('options', [])
        if len(opts) != 4:
            warnings.append(f"{mid}: has {len(opts)} options, expected 4.")
        if m.get('correct_answer') not in opts:
            errors.append(f"{mid}: correct_answer does not exactly match any option.")

        # distractor_rationale should cover exactly the 3 wrong options
        wrong_opts = [o for o in opts if o != m.get('correct_answer')]
        rationale_keys = set(m.get('distractor_rationale', {}).keys())
        if set(wrong_opts) != rationale_keys:
            warnings.append(f"{mid}: distractor_rationale keys don't exactly match the 3 wrong options.")        # explanation completeness
        ex = m.get('explanation', {})
        required_ex_fields = ['core_concept', 'why_correct', 'why_others_wrong', 'high_yield_facts',
                               'neet_pg_takeaway', 'source_type', 'source_reference']
        for field in required_ex_fields:
            if not ex.get(field):
                warnings.append(f"{mid}: explanation missing or empty field '{field}'.")

        if m.get('source_topic') not in ('SOURCE-DERIVED', 'CURRENT-KNOWLEDGE', 'GUIDELINE-SENSITIVE'):
            warnings.append(f"{mid}: unexpected/missing top-level source_topic tag: {m.get('source_topic')}")

    # meta.mcq_count should match actual count
    meta_count = ch.get('meta', {}).get('mcq_count')
    if meta_count != len(mcqs):
        errors.append(f"meta.mcq_count ({meta_count}) != actual mcqs length ({len(mcqs)}).")

    # NEW: per-concept type coverage check — the actual point of the "every concept
    # gets every applicable type" standard. A concept appearing only once means the
    # 'concept' label was never actually shared across multiple questions.
    from collections import defaultdict
    concept_types = defaultdict(set)
    concept_counts = defaultdict(int)
    for m in mcqs:
        c = m.get('concept', '<no concept>')
        concept_types[c].add(m.get('question_type'))
        concept_counts[c] += 1
    for c, types in concept_types.items():
        if len(types) < 4:
            errors.append(f"Concept '{c[:60]}' has only {len(types)} question_type(s) ({sorted(types)}) — standard requires ~5-8 genuinely applicable types per concept, not 1 per concept.")

    print(f"=== {path} ===")
    print(f"MCQs: {len(mcqs)}")
    if errors:
        print(f"\n{len(errors)} ERROR(S):")
        for e in errors:
            print("  ERROR:", e)
    if warnings:
        print(f"\n{len(warnings)} WARNING(S):")
        for w in warnings:
            print("  WARN:", w)
    if not errors and not warnings:
        print("Clean — no errors or warnings.")
    print()
    return len(errors) == 0

if __name__ == '__main__':
    ok = validate(sys.argv[1])
    sys.exit(0 if ok else 1)
