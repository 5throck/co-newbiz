---
lang: en
counterpart: human-in-the-loop-ui_ko.md
---

# Research Note — Human-in-the-Loop UI Standard Practices

> 🌐 External reference material. Researched: 2026-09-05. For comparing industry practices behind the "engine recommendation ≠ adoption" principle (Guardrail #2).

## Standard Practices

1. **Definition of HITL**: a model in which humans make decisions and AI only provides recommendations —
   structurally different from human-on-the-loop (HOTL), where AI executes end-to-end and humans only
   audit afterward. AI provides the intelligence; humans provide approval authority
2. **Standard workflow**: AI generates recommendations/drafts → the workflow routes to a designated
   reviewer and **pauses** → the human reviews/approves/edits/rejects → execution resumes according to
   that decision — nothing executes during the intermediate step
3. **Common failure patterns**: automation bias (trusting AI recommendations even when they are wrong),
   complacency (assuming the system handles everything, leading to reduced vigilance), and over-escalation
   (passing even low-risk·routine cases to humans, overwhelming reviewers — once overwhelmed, they stop
   reviewing properly and simply approve)
4. **Criteria for when to involve a human**: irreversible actions (file deletion·sending email) always
   require approval; actions affecting external systems or others warrant extra caution; low confidence
   calls for a clarification request; costly actions require approval
5. **A research finding worth heeding**: in one study, 66% of participants preferred delegating decisions
   to an algorithm over an equally accurate human, and this preference grew stronger when monitoring and
   adjustment were possible — yet participants intervened *less* when recommendations were the least
   accurate. In other words, merely adding HITL design does not automatically improve outcomes;
   **UI design that actively prevents overconfidence** is required

## co-newbiz mapping

- The "engine recommendation ≠ adoption" principle (Guardrail #2) exactly matches HITL's core definition
  ("AI recommends, humans decide"). The rule that GateDecisionPanel must visually separate AI proposals is
  a concrete implementation of "anti-overconfidence UI."
- The Kill Criteria rule that "no single reviewer can unilaterally waive" embodies the same principle as
  the HITL judgment criterion that irreversible actions always require human approval.
- When designing future screens, the principle "low-risk items are not escalated to gate decision cards"
  needs to be explicitly reviewed — research shows over-escalation actually degrades review quality.

## Sources

- Redis, "AI Human in the Loop: Production Oversight Patterns" — https://redis.io/blog/ai-human-in-the-loop/ (accessed 2026-09-05)
- Zapier, "Human-in-the-loop in AI workflows: Meaning and patterns" — https://zapier.com/blog/human-in-the-loop/ (accessed 2026-09-05)
- Elementum, "Human-in-the-Loop vs Human-on-the-Loop: Enterprise Guide" — https://www.elementum.ai/blog/human-in-the-loop-vs-human-on-the-loop (accessed 2026-09-05)
- NCBI, "Putting a human in the loop: Increasing uptake, but decreasing accuracy of automated decision-making" — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10857587/ (accessed 2026-09-05)
