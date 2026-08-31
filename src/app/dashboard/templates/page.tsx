import { TemplateEditor } from "@/components/dashboard/template-editor";
import { DEFAULT_TEMPLATE_BODY } from "@/lib/templates";
import { requireSession } from "@/server/auth";
import * as repo from "@/server/repo";
import { saveTemplate, sendTestMessage } from "../actions";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const { client } = await requireSession();
  const template = await repo.getDefaultTemplate(client.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Template</h1>
        <p className="text-sm text-muted-foreground">
          The one message every missed caller receives.
        </p>
      </div>
      <TemplateEditor
        initialBody={template?.body ?? DEFAULT_TEMPLATE_BODY}
        businessName={client.name}
        saveAction={saveTemplate}
        testAction={sendTestMessage}
      />
    </div>
  );
}
