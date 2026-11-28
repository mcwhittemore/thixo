# @thixo/site

The thixo demo site, live at [mcwhittemore.github.io/thixo](https://mcwhittemore.github.io/thixo/). It isn't
published to npm.

```sh
npm run build -w @thixo/site   # writes packages/site/dist
npm test -w @thixo/site        # builds it, serves it under /thixo/ and checks the program animates
```

`.github/workflows/pages.yml` builds it and deploys `dist` to GitHub Pages on every merge to `main`, and on
`workflow_dispatch`. The page loads its assets by relative path, so it works under the repo's subpath.
