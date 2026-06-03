// Stub for sections that aren't built yet. Lets us land the layout +
// nav without finishing every screen at once.
export function PlaceholderPage({ title, summary }: { title: string; summary: string }) {
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl text-ink mb-1">{title}</h1>
      <p className="text-muted text-sm">{summary}</p>
      <div className="mt-6 card card-padding text-muted">
        Coming in a follow-up commit.
      </div>
    </div>
  )
}
