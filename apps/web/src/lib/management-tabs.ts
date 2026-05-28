export type ManagementTabTarget = 'start' | 'courses' | 'periods' | 'weekly' | 'curriculum' | 'progress' | 'import';

export const managementActiveTabStorageKey = 'teacheros_management_active_tab_v1';

export function rememberManagementTab(tab: ManagementTabTarget): void {
  window.localStorage.setItem(managementActiveTabStorageKey, tab);
}
