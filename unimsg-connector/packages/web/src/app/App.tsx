import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { InboxPage } from '../features/inbox/InboxPage';
import { TodosPage } from '../features/todos/TodosPage';
import { TracePage } from '../features/trace/TracePage';
import { AccountsPage } from '../features/accounts/AccountsPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:traceId" element={<InboxPage />} />
        <Route path="/todos" element={<TodosPage />} />
        <Route path="/trace" element={<TracePage />} />
        <Route path="/trace/:traceId" element={<TracePage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Route>
    </Routes>
  );
}