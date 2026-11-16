<script lang="ts">
	import { currency, type Currency } from '#lib';
	import SettingRow from './SettingRow.svelte';

	// Currency setting (client-only, uses currency store)
	let selectedCurrency = $state<Currency>(currency.current);

	function handleCurrencyChange(event: Event & { currentTarget: HTMLSelectElement }) {
		const newCurrency = event.currentTarget.value as Currency;
		selectedCurrency = newCurrency;
		currency.set(newCurrency);
	}
</script>

<div class="card bg-base-200 shadow-lg">
	<div class="card-body">
		<h2 class="card-title mb-4">Display Settings</h2>

		<div class="divide-y divide-base-300">
			<SettingRow
				label="Price Currency"
				description="Choose which currency to display for card prices">
				<select
					class="select select-bordered w-full max-w-xs"
					value={selectedCurrency}
					onchange={handleCurrencyChange}>
					<option value="usd">USD ($)</option>
					<option value="eur">EUR (€)</option>
				</select>
			</SettingRow>
		</div>
	</div>
</div>
