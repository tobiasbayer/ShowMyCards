import type { MenuItem } from '#lib/types/navigation.ts';
import {
	LayoutDashboard,
	Cog,
	GalleryVerticalEnd,
	Archive,
	Scale,
	ListTodo,
	Layers,
	Grid2x2,
	Activity,
	Download
} from '@lucide/svelte';

export const menuItems: MenuItem[] = [
	{
		name: 'Dashboard',
		href: '/',
		icon: LayoutDashboard
	},
	{
		name: 'Cards',
		href: '/cards',
		icon: GalleryVerticalEnd
	},
	{
		name: 'Import',
		href: '/import',
		icon: Download
	},
	{
		name: 'Inventory',
		href: '/inventory',
		icon: Grid2x2
	},
	{
		name: 'Lists',
		href: '/lists',
		icon: ListTodo
	},
	{
		name: 'Decks',
		href: '/decks',
		icon: Layers
	},
	{
		name: 'Storage Locations',
		href: '/storage',
		icon: Archive
	},
	{
		name: 'Storage Rules',
		href: '/rules',
		icon: Scale
	},
	{
		name: 'Jobs',
		href: '/jobs',
		icon: Activity
	},
	{
		name: 'Settings',
		href: '/settings',
		icon: Cog
	}
];
