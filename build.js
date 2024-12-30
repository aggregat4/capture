const esbuild = require('esbuild');

const isDev = process.argv.includes('--dev');

// Build the main bundle
esbuild.build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  outfile: 'dist/bundle.js',
  minify: !isDev,
  sourcemap: isDev,
  loader: { 
    '.tsx': 'tsx', 
    '.ts': 'tsx'
  },
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  }
}).catch(() => process.exit(1));

// Build the CSS separately
esbuild.build({
  entryPoints: ['src/App.css'],
  bundle: true,
  outfile: 'dist/styles.css',
  minify: !isDev,
  sourcemap: isDev
}).catch(() => process.exit(1));

if (isDev) {
  // Watch mode for both JS and CSS
  const watch = async () => {
    const jsContext = await esbuild.context({
      entryPoints: ['src/index.tsx'],
      bundle: true,
      outfile: 'dist/bundle.js',
      minify: !isDev,
      sourcemap: isDev,
      loader: { 
        '.tsx': 'tsx', 
        '.ts': 'tsx'
      },
      define: {
        'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
      }
    });

    const cssContext = await esbuild.context({
      entryPoints: ['src/App.css'],
      bundle: true,
      outfile: 'dist/styles.css',
      minify: !isDev,
      sourcemap: isDev
    });

    await Promise.all([
      jsContext.watch(),
      cssContext.watch()
    ]);
    console.log('Watching for changes...');
  };

  watch().catch(() => process.exit(1));
} 