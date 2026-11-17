import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Dropdown from './Dropdown.svelte';

const trigger = createRawSnippet(() => ({ render: () => '<span>Pick one</span>' }));

/** One item, "Elves", that calls `onPick` and closes the menu. */
function items(onPick: () => void) {
	return createRawSnippet((close: () => () => void) => ({
		render: () => '<li><button type="button">Elves</button></li>',
		setup: (node: Element) => {
			node.querySelector('button')!.addEventListener('click', () => {
				onPick();
				close()();
			});
		}
	}));
}

/** Whether the menu is open; a closed <details> hides its items from role queries. */
const isOpen = () => document.querySelector('details')?.open ?? false;

async function setup(props: Record<string, unknown> = {}) {
	const onPick = vi.fn();
	const onOpenChange = vi.fn();
	await render(Dropdown, {
		trigger,
		children: items(onPick),
		label: 'Deck',
		onOpenChange,
		...props
	});
	return { onPick, onOpenChange, summary: page.getByLabelText('Deck') };
}

describe('Dropdown', () => {
	it('opens on click and closes after a pick', async () => {
		const { onPick, onOpenChange, summary } = await setup();

		expect(isOpen()).toBe(false);
		await summary.click();
		await page.getByRole('button', { name: 'Elves' }).click();

		expect(onPick).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(isOpen()).toBe(false));
		expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
	});

	it('takes Esc for itself, so a surrounding dialog stays open, and refocuses the trigger', async () => {
		const outer = vi.fn();
		window.addEventListener('keydown', outer);
		const { summary } = await setup();

		await summary.click();
		expect(isOpen()).toBe(true);
		await userEvent.keyboard('{Escape}');

		await vi.waitFor(() => expect(isOpen()).toBe(false));
		expect(outer).not.toHaveBeenCalled();
		await expect.element(summary).toHaveFocus();
		window.removeEventListener('keydown', outer);
	});

	it('leaves Esc alone while closed', async () => {
		const outer = vi.fn();
		window.addEventListener('keydown', outer);
		await setup();

		await userEvent.keyboard('{Escape}');

		expect(outer).toHaveBeenCalledOnce();
		window.removeEventListener('keydown', outer);
	});

	it('closes on a click outside', async () => {
		const { summary } = await setup();

		await summary.click();
		expect(isOpen()).toBe(true);
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

		await vi.waitFor(() => expect(isOpen()).toBe(false));
	});

	it('closes when it becomes disabled', async () => {
		const onPick = vi.fn();
		const { rerender } = await render(Dropdown, {
			trigger,
			children: items(onPick),
			label: 'Deck'
		});

		await page.getByLabelText('Deck').click();
		expect(isOpen()).toBe(true);
		await rerender({ disabled: true });

		await vi.waitFor(() => expect(isOpen()).toBe(false));
	});

	it("can't be opened while disabled, and keeps its tooltip", async () => {
		const { summary } = await setup({ disabled: true, title: 'The order in your search applies' });

		await expect.element(summary).toHaveAttribute('aria-disabled', 'true');
		await expect.element(summary).toHaveAttribute('tabindex', '-1');
		await expect.element(page.getByTitle('The order in your search applies')).toBeInTheDocument();
	});
});
