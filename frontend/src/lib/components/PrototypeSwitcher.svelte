<!--
	PROTOTYPE. Floating bottom bar that cycles UI prototype variants via the
	`?variant=` search param. On the prototype branch it ships in production builds too.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';

	interface Variant {
		/** `null` means "no variant param", i.e. the route's default page. */
		key: string | null;
		label: string;
	}

	let { variants, note }: { variants: Variant[]; note?: string } = $props();

	const currentKey = $derived(page.url.searchParams.get('variant'));
	const index = $derived(
		Math.max(
			0,
			variants.findIndex((v) => v.key === currentKey)
		)
	);
	const current = $derived(variants[index]);

	function cycle(step: number) {
		const next = variants[(index + step + variants.length) % variants.length];
		// Read the live location, not `page.url`: shallow `replaceState` (used by the
		// prototypes for typing/filter state) does not update `page.url`.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-off URL builder, not state
		const params = new URLSearchParams(window.location.search);
		if (next.key === null) params.delete('variant');
		else params.set('variant', next.key);
		const query = params.toString();
		const path = `${page.url.pathname}${query ? `?${query}` : ''}`;
		goto(resolve(path as '/'), { replaceState: true, noScroll: true, keepFocus: true });
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') ||
				target.isContentEditable)
		) {
			return;
		}
		event.preventDefault();
		cycle(event.key === 'ArrowLeft' ? -1 : 1);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 flex items-center gap-1 rounded-full bg-neutral py-1 pl-1 pr-3 text-sm text-neutral-content shadow-xl ring-1 ring-black/10">
	<button
		type="button"
		class="btn btn-circle btn-ghost btn-xs text-neutral-content"
		aria-label="Previous variant"
		onclick={() => cycle(-1)}>
		<ChevronLeft class="size-4" />
	</button>
	<span class="min-w-36 text-center font-medium tabular-nums">
		{index + 1}/{variants.length} · {current.label}
	</span>
	<button
		type="button"
		class="btn btn-circle btn-ghost btn-xs text-neutral-content"
		aria-label="Next variant"
		onclick={() => cycle(1)}>
		<ChevronRight class="size-4" />
	</button>
	{#if note && current.key !== null}
		<span class="ml-1 border-l border-neutral-content/20 pl-3 text-xs opacity-60">{note}</span>
	{/if}
</div>
