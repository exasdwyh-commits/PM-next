import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../package.json', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fileURLToPath(new URL('./src/', import.meta.url));
export default { plugins: [require('tailwindcss')({ config: `${root}tailwind.config.ts`, content: [`${root}src/**/*.{js,ts,jsx,tsx,mdx}`, `${source}**/*.{ts,tsx}`] }), require('autoprefixer')()] };
