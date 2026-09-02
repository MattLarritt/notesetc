import { AdminHelp } from '../admin-help';
import { AiSettingsForm } from './ai-settings-form';

export const dynamic = 'force-dynamic';

export default function AdminAiPage() {
  return (
    <div>
      <div className="page-actions">
        <h2 style={{ margin: 0 }}>AI agent</h2>
        <AdminHelp>
          <p>Optional. Connect a model and every signed-in user gets the AI menu: chat that
          answers from their notes, and AI-assisted document filing. The assistant acts with
          each asking user&apos;s own permissions and every write is attributed to it. The API
          key is stored encrypted and never shown again.</p>
        </AdminHelp>
      </div>
      <AiSettingsForm />
    </div>
  );
}
