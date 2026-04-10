import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/api/chat/ws': {
				target: 'http://localhost:8000',
				ws: true,
			},
		},
	},
});
