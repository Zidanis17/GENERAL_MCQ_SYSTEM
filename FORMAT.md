# MCQ Studio file format

Save a UTF-8 `.json` file up to **10 MiB**. Each file represents one question bank. Use **Save example JSON** in the app’s **File format & help** dialog for a working example.

```json
{
  "schemaVersion": 1,
  "id": "biology-basics",
  "title": "Biology basics",
  "description": "An optional description",
  "questions": [
    {
      "id": "q1",
      "prompt": "How many chambers does a typical human heart have?",
      "options": [
        { "id": "a", "text": "Two" },
        { "id": "b", "text": "Four" }
      ],
      "correctOptionId": "b",
      "explanation": "Two atria and two ventricles."
    }
  ]
}
```

Required bank fields: `schemaVersion` (the number `1`), `id`, `title`, and `questions`. `description` is optional. There must be at least one question.

Required question fields: `id`, `prompt`, `options`, and `correctOptionId`. `explanation` is optional. Each question needs at least two options, each with an `id` and `text`. All required text must contain at least one non-whitespace character.

IDs are strings. Every question ID must be unique within its bank; every option ID must be unique within its question. `correctOptionId` must exactly match one option’s ID, including capitalization. Only one correct answer is supported.

Bank IDs identify imported banks. Reimporting the same ID offers to replace that bank. Existing results and unfinished quizzes retain their own question snapshots, so edits never change earlier work. Change the bank ID to import it as a separate bank.

Use any language, including Arabic. Question prompts, answers, and explanations are rendered as plain text with automatic text direction. Encode line breaks as `\n` inside JSON strings. Images, HTML rendering, and Markdown formatting are not supported. Extra JSON fields are ignored. UTF-8 byte-order marks are accepted. JSON comments and trailing commas are not valid.

`question-bank.schema.json` provides editor validation. Unique IDs and correct-answer references are additionally validated by the app because standard JSON Schema cannot express these references. Import errors identify fields using zero-based indices: `questions[0]` means the first question.

You can ask a question-writing tool:

> Create a valid MCQ Studio JSON question bank using schemaVersion 1, a unique bank id, a title, and a questions array. Each question needs a unique id, prompt, at least two options with unique id and text, exactly one correctOptionId, and an optional explanation. Output JSON only. Use plain text, with no images.
