<!--
	The Add to deck dialog's deck field: a dropdown of the decks with "New" beside
	it, or a name input for a new deck. Shows loading and a retryable failure.
-->
<script lang="ts">
	import { Check, Plus } from '@lucide/svelte';
	import type { DeckChoice } from './deck-choice.svelte';
	import Dropdown from './Dropdown.svelte';

	let { choice, id }: { choice: DeckChoice; id: string } = $props();

	function onNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			choice.create();
		} else if (e.key === 'Escape' && choice.decks.length > 0) {
			// Handled here: the dialog stays open (it skips a handled Esc).
			e.preventDefault();
			choice.creating = false;
		}
	}
</script>

<div class="flex flex-col gap-2">
	<!-- Names the new-deck input by `for`, and the deck dropdown by aria-labelledby. -->
	<label id="{id}-label" for={id} class="font-semibold">Deck</label>
	{#if choice.loadState === 'loading'}
		<div class="flex items-center gap-2 text-sm opacity-70">
			<span class="loading loading-spinner loading-sm"></span>
			Loading decks…
		</div>
	{:else if choice.loadState === 'error'}
		<div role="alert" class="alert alert-error alert-soft py-2 text-sm">
			<span>Couldn't load your decks.</span>
			<button type="button" class="btn btn-ghost btn-xs" onclick={() => choice.load()}
				>Retry</button>
		</div>
	{:else if choice.creating}
		{#if choice.decks.length === 0}
			<p class="text-sm opacity-70">You have no decks yet. Name your first one:</p>
		{/if}
		<div class="join w-full">
			<input
				{id}
				class="input input-sm join-item flex-1"
				placeholder="New deck name"
				bind:value={choice.newName}
				onkeydown={onNameKeydown}
				disabled={choice.saving} />
			<button
				type="button"
				class="btn btn-sm btn-primary join-item"
				onclick={() => choice.create()}
				disabled={!choice.newName.trim() || choice.saving}>
				{#if choice.saving}<span class="loading loading-spinner loading-xs"></span>{/if}
				Create
			</button>
			{#if choice.decks.length > 0}
				<button
					type="button"
					class="btn btn-sm join-item"
					onclick={() => (choice.creating = false)}>
					Cancel
				</button>
			{/if}
		</div>
	{:else}
		<div class="flex gap-2">
			<Dropdown
				class="min-w-0 flex-1"
				placement="dropdown-start"
				fullWidth
				summaryClass="select select-sm w-full"
				menuClass="w-full max-h-60"
				labelledby="{id}-label">
				{#snippet trigger()}
					<span class="truncate {choice.selected ? '' : 'text-base-content/60'}">
						{choice.selected?.name ?? 'Select a deck…'}
					</span>
				{/snippet}
				{#snippet children(close)}
					{#each choice.decks as deck (deck.id)}
						<li>
							<button
								type="button"
								title={deck.name}
								onclick={() => {
									choice.deckId = String(deck.id);
									close();
								}}>
								<span class="flex-1 truncate">{deck.name}</span>
								{#if String(deck.id) === choice.deckId}<Check
										class="size-3.5 shrink-0 opacity-60" />{/if}
							</button>
						</li>
					{/each}
				{/snippet}
			</Dropdown>
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				onclick={() => (choice.creating = true)}
				title="Create a new deck">
				<Plus class="h-4 w-4" />
				New
			</button>
		</div>
	{/if}
</div>
