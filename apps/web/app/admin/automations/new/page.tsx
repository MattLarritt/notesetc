import { AutomationEditor } from '../[id]/automation-editor';

export const dynamic = 'force-dynamic';

export default function NewAutomationPage() {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>New automation</h2>
      <AutomationEditor automation={null} />
    </div>
  );
}
