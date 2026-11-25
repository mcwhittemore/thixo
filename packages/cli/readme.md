# thixo

The `thixo` command.

```sh
thixo compile <folder|file.thx> [-o out.js] [--entry main.thx] [--modules decls.json] [--json]
```

Compiles a program to one ES module. `--modules` is a JSON file mapping each host module's specifier to its `.d.ts`
text, or to a `.d.ts` path relative to the JSON. Errors print as `file:line:column code message`. Exit code 0 when
it compiled, 1 when the source has errors, 2 for bad usage.

`main(argv, io)` and `readProgram(path)` are exported for scripts that want the same behaviour.
