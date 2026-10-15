import path from 'node:path';

export function desktopMainBuildOptions({ sourceRoot, distRoot, base }) {
  const entry = path.resolve(sourceRoot, 'main.mjs');
  return { ...base, entryPoints: [entry], outfile: path.join(distRoot, 'main.mjs'),
    plugins: [...(base.plugins ?? []), {
      name: 'desktop-native-resource-module-boundary',
      setup(builder) {
        // The native host is already emitted and unpacked at this exact path.
        // Inlining it into main would relocate scene-server's import.meta.url.
        builder.onResolve({ filter: /^\.\/desktop-engine-host\.mjs$/ }, args => {
          if (path.resolve(args.importer) !== entry) return null;
          return { path: './bridge-runtime/src/desktop-engine-host.mjs', external: true };
        });
      },
    }],
  };
}
