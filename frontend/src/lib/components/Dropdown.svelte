<!--
	Dropdown menu that never opens an OS menu: a DaisyUI <details class="dropdown">.
	The <summary> is the trigger; `children` renders the menu's <li> items and gets
	`close` to call after a pick. Esc or a click outside closes only this menu: Esc
	is taken in the capture phase, so a surrounding dialog or panel never sees it,
	and focus returns to the trigger.

	No tabindex on an enabled summary (it is focusable anyway): DaisyUI's
	`.dropdown:focus-within > [tabindex]:first-child` turns off its pointer events
	on focus, which swallows the click that should open the menu.
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';

	let {
		trigger,
		children,
		placement = 'dropdown-end',
		class: className = '',
		summaryClass = '',
		menuClass = 'w-56',
		fullWidth = false,
		disabled = false,
		title,
		label,
		labelledby,
		onOpenChange
	}: {
		/** What the closed menu shows, inside the <summary>. */
		trigger: Snippet;
		/** The menu's <li> items; `close` closes the menu, e.g. after a pick. */
		children: Snippet<[close: () => void]>;
		/** DaisyUI placement classes for the <details>, e.g. `dropdown-top dropdown-center`. */
		placement?: string;
		/** Classes for the wrapper (layout in the parent, e.g. `flex-1`). */
		class?: string;
		/** Classes for the trigger, e.g. `select select-sm` or `btn btn-ghost`. */
		summaryClass?: string;
		/** Classes for the menu list: width, max height. */
		menuClass?: string;
		/** Stretch the trigger to the wrapper's width, like a form control. */
		fullWidth?: boolean;
		disabled?: boolean;
		/** Tooltip. It sits on the wrapper: a disabled summary takes no pointer events. */
		title?: string;
		/** Accessible name of the trigger. */
		label?: string;
		/** Id of an element that names the trigger (a form label), instead of `label`. */
		labelledby?: string;
		/** Called with true when the menu opens, and with false when it closes or goes away. */
		onOpenChange?: (open: boolean) => void;
	} = $props();

	/** Opened by the user; a disabled menu is never shown open, as a pick would do nothing. */
	let open = $state(false);
	const shown = $derived(open && !disabled);
	let root = $state<HTMLDetailsElement>();
	let summary = $state<HTMLElement>();
	const top = $derived(placement.includes('dropdown-top'));

	// Untracked: the callback may read state it writes (an open-menu counter), which
	// would otherwise re-run this effect on every write.
	$effect(() => {
		if (!shown) return;
		untrack(() => onOpenChange?.(true));
		return () => untrack(() => onOpenChange?.(false));
	});

	function close() {
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (!shown || event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		open = false;
		summary?.focus();
	}

	function onPointerDown(event: PointerEvent) {
		if (shown && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onkeydowncapture={onKeydown} onpointerdown={onPointerDown} />

<div class={className} {title}>
	<details
		class="dropdown {placement} {fullWidth ? 'w-full' : ''}"
		open={shown}
		ontoggle={(e) => (open = e.currentTarget.open)}
		bind:this={root}>
		<summary
			bind:this={summary}
			class="{summaryClass} {disabled ? 'pointer-events-none opacity-50' : ''}"
			aria-label={label}
			aria-labelledby={labelledby}
			aria-disabled={disabled || undefined}
			tabindex={disabled ? -1 : undefined}>
			{@render trigger()}
		</summary>
		<ul
			class="dropdown-content menu menu-sm z-20 {top
				? 'mb-1'
				: 'mt-1'} flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg {menuClass}">
			{@render children(close)}
		</ul>
	</details>
</div>
