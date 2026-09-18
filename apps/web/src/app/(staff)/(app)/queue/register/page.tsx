'use client';

import { useMemo } from 'react';
import { useAppContext } from '@/lib/context/app-context-provider';
import { hasPermission } from '@/lib/auth/permissions';
import { useQueueBoard } from '@/lib/queue/use-queue-board';
import { ScreenHeader } from '@/components/app/screen-header';
import { NextTokenCard } from '@/components/queue/next-token-card';
import { RegisterForm } from '@/components/queue/register-form';
import chrome from '@/components/app/screen-chrome.module.css';

/**
 * Customer Register — self check-in at the counter: the next token number,
 * then name, phone, adults and kids. A party joins the live queue now; holding
 * a table for later is the podium's job.
 *
 * The next number comes from the board, which needs queue.view; without it
 * the card shows a dash and registration still works.
 */
export default function RegisterPage() {
  const { selectedCompanyId, selectedBranchId, selectedBranch, branchPermissions } = useAppContext();
  const ctx = useMemo(
    () =>
      selectedCompanyId && selectedBranchId
        ? { companyId: selectedCompanyId, branchId: selectedBranchId }
        : null,
    [selectedCompanyId, selectedBranchId],
  );
  const mayRegister = hasPermission(branchPermissions, 'queue.register');
  const mayView = hasPermission(branchPermissions, 'queue.view');
  const { board, refresh } = useQueueBoard(mayRegister && mayView ? ctx : null);

  const header = <ScreenHeader title="Customer Register" />;

  if (!mayRegister || !ctx) {
    return (
      <>
        {header}
        <div className={chrome.content}>
          <p role="alert" className={chrome.alert}>
            You do not have permission to register parties at this branch.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className={chrome.content}>
        <NextTokenCard number={board?.next_token_number ?? null} />
        <RegisterForm
          ctx={ctx}
          timezone={selectedBranch?.timezone ?? 'UTC'}
          allowAdvance={false}
          submitLabel="Register Customer"
          onRegistered={() => void (mayView ? refresh() : undefined)}
        />
      </div>
    </>
  );
}
