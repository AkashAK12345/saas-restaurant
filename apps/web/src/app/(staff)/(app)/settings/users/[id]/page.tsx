"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useAppContext } from "@/lib/context/app-context-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { hasPermission } from "@/lib/auth/permissions";
import {
  userAccessApi,
  type AccessCatalogue,
  type UserAccessDetail,
} from "@/lib/users/access";
import { AppIcon } from "@/components/app/icons";
import { ScreenHeader } from "@/components/users/controls";
import {
  UserAccessForm,
  type AccessFormValues,
} from "@/components/users/user-access-form";
import styles from "@/components/users/users.module.css";

/**
 * One member's access, opened from Existing Users. The same form as Create
 * New, without the password (an account's credentials are its owner's).
 * Saving replaces whatever shared roles they held before.
 */
export default function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { selectedCompanyId, companyPermissions } = useAppContext();
  const { user: me } = useAuth();
  const mayUpdate = hasPermission(companyPermissions, "users.update");

  const [catalogue, setCatalogue] = useState<AccessCatalogue | null>(null);
  const [detail, setDetail] = useState<UserAccessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!selectedCompanyId) return;
    let live = true;
    Promise.all([
      userAccessApi.catalogue(selectedCompanyId),
      userAccessApi.detail(selectedCompanyId, id),
    ])
      .then(([c, d]) => {
        if (!live) return;
        setCatalogue(c);
        setDetail(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (live)
          setError(
            e instanceof Error ? e.message : "Could not load this user.",
          );
      });
    return () => {
      live = false;
    };
  }, [selectedCompanyId, id]);

  const save = async (values: AccessFormValues) => {
    if (!selectedCompanyId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await userAccessApi.save(selectedCompanyId, id, {
        user_type: values.user_type,
        corporate: values.corporate,
        branch_id: values.branch_id,
        access: values.access,
      });
      setDetail(saved);
      setFormKey((k) => k + 1);
      setNotice("Access saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const locked = detail?.owner
    ? "This is the owner account. It has full access everywhere and cannot be changed."
    : me?.id === id
      ? "You cannot change your own access."
      : !mayUpdate
        ? "You do not have permission to change users."
        : undefined;

  return (
    <div className={styles.page}>
      <ScreenHeader
        title={detail?.name ?? "User"}
        back={
          <Link
            className={styles.back}
            href="/settings/users"
            aria-label="Back to User Management"
          >
            <AppIcon name="back" size={26} />
          </Link>
        }
      />
      <div className={styles.panel}>
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {catalogue && detail ? (
          <UserAccessForm
            key={formKey}
            catalogue={catalogue}
            mode="edit"
            email={detail.email}
            initial={{
              user_type: detail.user_type,
              corporate: detail.corporate,
              branch_id: detail.branch?.id ?? null,
              access: detail.access,
            }}
            notice={
              detail.managed
                ? undefined
                : "These toggles show what this user’s current roles allow. Saving replaces those roles with exactly what is switched on here."
            }
            locked={locked}
            busy={busy}
            onSubmit={save}
          />
        ) : !error ? (
          <p className={styles.empty}>Loading…</p>
        ) : null}
      </div>
    </div>
  );
}
