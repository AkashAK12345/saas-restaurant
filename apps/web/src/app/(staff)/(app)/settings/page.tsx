'use client';

import { useAppContext } from '@/lib/context/app-context-provider';
import { settingsMenuFor } from '@/lib/settings/settings-menu';
import { SettingsMenuList } from '@/components/settings/settings-sheet';
import styles from '@/components/settings/settings.module.css';

/**
 * Settings — the same menu the phone's bottom bar opens as a sheet, as a page
 * for the side navigation. Both read SETTINGS_MENU through the same
 * permission rule, so a row cannot appear in one and be missing in the other.
 */
export default function SettingsPage() {
  const { companyPermissions, branchPermissions, selectedBranchId } = useAppContext();
  const permissions = Array.from(new Set([...companyPermissions, ...branchPermissions]));
  const entries = settingsMenuFor(permissions, !!selectedBranchId);

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>
      <nav className={styles.menuPanel} aria-label="Settings">
        <SettingsMenuList entries={entries} />
      </nav>
    </section>
  );
}
