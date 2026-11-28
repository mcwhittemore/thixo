export function Source({ files }: { files: Record<string, string> }) {
  const names = Object.keys(files);
  return (
    <div className="source" data-testid="source">
      {names.map((name) => (
        <figure key={name} data-file={name}>
          {names.length > 1 && <figcaption>{name}</figcaption>}
          <pre>
            <code>{files[name]}</code>
          </pre>
        </figure>
      ))}
    </div>
  );
}
