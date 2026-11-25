import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidatePrintings, loadPrintings } from './printings';
import { card } from './test-fixtures';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('printings cache', () => {
	beforeEach(() => {
		invalidatePrintings();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('requests /api/cards/printings/:oracle_id with lang when provided and omits it when empty', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(async () => json([card([], {}, { id: 'bolt-ja', language: 'ja' })]));

		const withLang = await loadPrintings('oracle-1', 'en');
		expect(withLang.map((c) => c.id)).toEqual(['bolt-ja']);
		expect(String(fetchSpy.mock.calls[0][0])).toMatch(
			/\/api\/cards\/printings\/oracle-1\?lang=en$/
		);

		await loadPrintings('oracle-1', '');
		expect(String(fetchSpy.mock.calls[1][0])).toMatch(/\/api\/cards\/printings\/oracle-1$/);
	});

	it('caches per (oracleId, language) without re-fetching', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([card()]));

		await loadPrintings('oracle-1', 'en');
		await loadPrintings('oracle-1', 'en');

		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('does not cache failed requests so retry issues a new fetch', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(json({ error: 'backend down' }, 500))
			.mockResolvedValueOnce(json([card()]));

		await expect(loadPrintings('oracle-1', 'en')).rejects.toThrow();
		const retried = await loadPrintings('oracle-1', 'en');

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(retried).toHaveLength(1);
	});

	it('invalidatePrintings(oracleId) clears only that oracle', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json([card()]));

		await loadPrintings('oracle-1', 'en');
		await loadPrintings('oracle-2', 'en');
		invalidatePrintings('oracle-1');

		await loadPrintings('oracle-1', 'en');
		await loadPrintings('oracle-2', 'en');

		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});
});
