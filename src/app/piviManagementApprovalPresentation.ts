import type { McpManagementPlan } from "@pivi/agent/mcp/mcpManagementCoordinator";
import type { SkillsManagementPlan } from "@pivi/agent/skills/vault/skillsManagementCoordinator";
import type {
  AgentMcpServerInput,
  PiviManagementApprovalRequest,
  PiviManagementPlanField,
  PiviManagementPlanValue,
} from "@pivi/agent/tools/piviManagement";

import type { TFunction } from "./i18n";
import type { PromptCompositionPlan } from './runtime/PromptCompositionCoordinator';
import type { WorkspaceCommandsPlan } from './runtime/WorkspaceCommandsCoordinator';

/** Pure app presentation boundary from normalized management data to approval-card copy. */
export function presentMcpManagementApproval(
  plan: McpManagementPlan,
  t: TFunction,
): PiviManagementApprovalRequest {
  const mutation = plan.mutation;
  const name = mutation.name;
  const title = mutation.action === "upsert"
    ? t("chat.piviManagementApproval.management.titles.mcp.upsert", { name })
    : mutation.action === "remove"
      ? t("chat.piviManagementApproval.management.titles.mcp.remove", { name })
      : t(mutation.enabled
        ? "chat.piviManagementApproval.management.titles.mcp.enable"
        : "chat.piviManagementApproval.management.titles.mcp.disable", { name });
  const change = mutation.action === "upsert" ? "mcpUpsert"
    : mutation.action === "remove" ? "mcpRemove"
      : mutation.enabled ? "mcpEnable" : "mcpDisable";
  const fields: PiviManagementPlanField[] = [field(t, "server", name)];
  if (mutation.action === "set_enabled") fields.push(field(t, "enabled", booleanValue(t, mutation.enabled)));
  if (mutation.action === "upsert") fields.push(...mcpServerFields(mutation.server, t));
  return request("mcp", mutation.action, title, plan.revision, [changeLine(t, change)], fields);
}

export function presentSkillsManagementApproval(
  plan: SkillsManagementPlan,
  t: TFunction,
): PiviManagementApprovalRequest {
  const mutation = plan.mutation;
  let title: string;
  let change: ChangeKey;
  const fields: PiviManagementPlanField[] = [];
  switch (mutation.action) {
    case "install":
      title = t("chat.piviManagementApproval.management.titles.skills.install", { source: mutation.source });
      change = "skillsInstall";
      fields.push(field(t, "source", mutation.source));
      if (mutation.skillNames?.length) fields.push(field(t, "skills", [...mutation.skillNames]));
      break;
    case "set_enabled":
      title = t(mutation.enabled
        ? "chat.piviManagementApproval.management.titles.skills.enable"
        : "chat.piviManagementApproval.management.titles.skills.disable", { name: mutation.name });
      change = mutation.enabled ? "skillsEnable" : "skillsDisable";
      fields.push(field(t, "skill", mutation.name), field(t, "enabled", booleanValue(t, mutation.enabled)));
      break;
    case "update":
      title = t("chat.piviManagementApproval.management.titles.skills.update", { name: mutation.name });
      change = "skillsUpdate";
      fields.push(field(t, "skill", mutation.name));
      break;
    case "update_all":
      title = t("chat.piviManagementApproval.management.titles.skills.updateAll");
      change = "skillsUpdateAll";
      break;
    case "remove":
      title = t("chat.piviManagementApproval.management.titles.skills.remove", { name: mutation.name });
      change = "skillsRemove";
      fields.push(field(t, "skill", mutation.name));
  }
  return request("skills", mutation.action, title, plan.revision, [changeLine(t, change)], fields);
}

export function presentCommandsManagementApproval(
  plan: WorkspaceCommandsPlan,
  t: TFunction,
): PiviManagementApprovalRequest {
  const input = plan.mutation;
  const command = `/${input.id}`;
  const title = t(COMMAND_TITLE_KEYS[input.action], { command });
  const fields: PiviManagementPlanField[] = [
    field(t, "command", command),
    field(t, "catalogRevision", input.catalogRevision),
  ];
  if (input.action === "upsert") {
    // Agent-authored description and argument hint are intentionally not presentation inputs.
    if (input.icon !== undefined) fields.push(field(t, "icon", input.icon));
    fields.push(field(t, "prompt", t("chat.piviManagementApproval.management.values.updated")));
  } else if (input.action === "move") {
    if (input.beforeId) fields.push(field(t, "before", `/${input.beforeId}`));
    if (input.afterId) fields.push(field(t, "after", `/${input.afterId}`));
  }
  return request("commands", input.action, title, plan.revision, [
    changeLine(t, `commands${capitalize(input.action)}` as ChangeKey),
  ], fields);
}

export function presentPromptManagementApproval(
  plan: PromptCompositionPlan,
  t: TFunction,
): PiviManagementApprovalRequest {
  const mutation = plan.mutation;
  const name = promptModuleName(mutation);
  const fields: PiviManagementPlanField[] = [
    field(t, "module", name),
    field(t, "catalogRevision", mutation.catalogRevision),
  ];
  let title: string;
  let change: ChangeKey;
  switch (mutation.action) {
    case "set_enabled":
      title = t(mutation.enabled
        ? "chat.piviManagementApproval.management.titles.prompt.enable"
        : "chat.piviManagementApproval.management.titles.prompt.disable", { name });
      change = mutation.enabled ? "promptEnable" : "promptDisable";
      fields.push(field(t, "enabled", booleanValue(t, mutation.enabled)));
      break;
    case "set_body":
      title = t("chat.piviManagementApproval.management.titles.prompt.setBody", { name });
      change = "promptSetBody";
      fields.push(field(t, "prompt", t("chat.piviManagementApproval.management.values.updated")));
      break;
    case "restore":
      title = t("chat.piviManagementApproval.management.titles.prompt.restore", { name });
      change = "promptRestore";
      break;
    case "upsert":
      title = t(mutation.id
        ? "chat.piviManagementApproval.management.titles.prompt.update"
        : "chat.piviManagementApproval.management.titles.prompt.create", { name });
      change = mutation.id ? "promptUpdate" : "promptCreate";
      if (mutation.title !== undefined) fields.push(field(t, "title", mutation.title));
      if (mutation.body !== undefined) {
        fields.push(field(t, "prompt", t("chat.piviManagementApproval.management.values.updated")));
      }
      if (mutation.enabled !== undefined) {
        fields.push(field(t, "enabled", booleanValue(t, mutation.enabled)));
      }
      break;
    case "remove":
      title = t("chat.piviManagementApproval.management.titles.prompt.remove", { name });
      change = "promptRemove";
      break;
    case "move":
      title = t("chat.piviManagementApproval.management.titles.prompt.move", { name });
      change = "promptMove";
      if (mutation.beforeId) fields.push(field(t, "before", mutation.beforeId));
      if (mutation.afterId) fields.push(field(t, "after", mutation.afterId));
      break;
  }
  return request("prompt", mutation.action, title, plan.revision, [changeLine(t, change)], fields);
}

function promptModuleName(mutation: PromptCompositionPlan["mutation"]): string {
  if ("title" in mutation && mutation.title?.trim()) return mutation.title.trim();
  if ("id" in mutation && mutation.id) return mutation.id;
  return "New module";
}

function mcpServerFields(server: AgentMcpServerInput, t: TFunction): PiviManagementPlanField[] {
  const fields: PiviManagementPlanField[] = [];
  fields.push(field(t, "type", server.type), field(t, "url", server.url));
  if (server.auth) fields.push(field(t, "auth", server.auth));
  const names = server.headers ? Object.keys(server.headers).sort() : [];
  if (names.length) fields.push(field(t, "headerNames", names));
  if (server.bearerToken?.source === "systemEnvironment") fieldPush(fields, t, "bearerToken", `env:${server.bearerToken.variable}`);
  else if (server.bearerToken?.source === "clear") fieldPush(fields, t, "bearerToken", t("chat.piviManagementApproval.management.values.clear"));
  if (server.oauth === false) fieldPush(fields, t, "oauth", t("chat.piviManagementApproval.management.values.disabled"));
  else if (server.oauth) {
    if (server.oauth.grantType) fieldPush(fields, t, "oauthGrant", server.oauth.grantType);
    if (server.oauth.clientId) fieldPush(fields, t, "oauthClientId", server.oauth.clientId);
    if (server.oauth.scope) fieldPush(fields, t, "oauthScope", server.oauth.scope);
    if (server.oauth.clearClientSecret) fieldPush(fields, t, "oauthClientSecret", t("chat.piviManagementApproval.management.values.clear"));
  }
  if (server.enabled !== undefined) fields.push(field(t, "enabled", booleanValue(t, server.enabled)));
  if (server.contextSaving !== undefined) fields.push(field(t, "contextSaving", booleanValue(t, server.contextSaving)));
  if (server.disabledTools?.length) fields.push(field(t, "disabledTools", [...server.disabledTools]));
  return fields;
}

type FieldKey = "server" | "enabled" | "type" | "command" | "args" | "envNames" | "url" | "auth" | "headerNames" | "bearerToken" | "oauth" | "oauthGrant" | "oauthClientId" | "oauthScope" | "oauthClientSecret" | "contextSaving" | "disabledTools" | "source" | "skills" | "skill" | "catalogRevision" | "icon" | "prompt" | "before" | "after" | "module" | "title";
type ChangeKey = "mcpUpsert" | "mcpEnable" | "mcpDisable" | "mcpRemove" | "skillsInstall" | "skillsEnable" | "skillsDisable" | "skillsUpdate" | "skillsUpdateAll" | "skillsRemove" | "commandsUpsert" | "commandsRemove" | "commandsMove" | "promptEnable" | "promptDisable" | "promptSetBody" | "promptRestore" | "promptCreate" | "promptUpdate" | "promptRemove" | "promptMove";

const COMMAND_TITLE_KEYS = {
  upsert: "chat.piviManagementApproval.management.titles.commands.upsert",
  remove: "chat.piviManagementApproval.management.titles.commands.remove",
  move: "chat.piviManagementApproval.management.titles.commands.move",
} as const;
const CHANGE_KEYS: Record<ChangeKey, Parameters<TFunction>[0]> = {
  mcpUpsert: "chat.piviManagementApproval.management.changes.mcpUpsert", mcpEnable: "chat.piviManagementApproval.management.changes.mcpEnable", mcpDisable: "chat.piviManagementApproval.management.changes.mcpDisable", mcpRemove: "chat.piviManagementApproval.management.changes.mcpRemove",
  skillsInstall: "chat.piviManagementApproval.management.changes.skillsInstall", skillsEnable: "chat.piviManagementApproval.management.changes.skillsEnable", skillsDisable: "chat.piviManagementApproval.management.changes.skillsDisable", skillsUpdate: "chat.piviManagementApproval.management.changes.skillsUpdate", skillsUpdateAll: "chat.piviManagementApproval.management.changes.skillsUpdateAll", skillsRemove: "chat.piviManagementApproval.management.changes.skillsRemove",
  commandsUpsert: "chat.piviManagementApproval.management.changes.commandsUpsert", commandsRemove: "chat.piviManagementApproval.management.changes.commandsRemove", commandsMove: "chat.piviManagementApproval.management.changes.commandsMove",
  promptEnable: "chat.piviManagementApproval.management.changes.promptEnable", promptDisable: "chat.piviManagementApproval.management.changes.promptDisable", promptSetBody: "chat.piviManagementApproval.management.changes.promptSetBody", promptRestore: "chat.piviManagementApproval.management.changes.promptRestore", promptCreate: "chat.piviManagementApproval.management.changes.promptCreate", promptUpdate: "chat.piviManagementApproval.management.changes.promptUpdate", promptRemove: "chat.piviManagementApproval.management.changes.promptRemove", promptMove: "chat.piviManagementApproval.management.changes.promptMove",
};
const FIELD_KEYS: Record<FieldKey, Parameters<TFunction>[0]> = {
  server: "chat.piviManagementApproval.management.fields.server", enabled: "chat.piviManagementApproval.management.fields.enabled", type: "chat.piviManagementApproval.management.fields.type", command: "chat.piviManagementApproval.management.fields.command", args: "chat.piviManagementApproval.management.fields.args", envNames: "chat.piviManagementApproval.management.fields.envNames", url: "chat.piviManagementApproval.management.fields.url", auth: "chat.piviManagementApproval.management.fields.auth", headerNames: "chat.piviManagementApproval.management.fields.headerNames", bearerToken: "chat.piviManagementApproval.management.fields.bearerToken", oauth: "chat.piviManagementApproval.management.fields.oauth", oauthGrant: "chat.piviManagementApproval.management.fields.oauthGrant", oauthClientId: "chat.piviManagementApproval.management.fields.oauthClientId", oauthScope: "chat.piviManagementApproval.management.fields.oauthScope", oauthClientSecret: "chat.piviManagementApproval.management.fields.oauthClientSecret", contextSaving: "chat.piviManagementApproval.management.fields.contextSaving", disabledTools: "chat.piviManagementApproval.management.fields.disabledTools", source: "chat.piviManagementApproval.management.fields.source", skills: "chat.piviManagementApproval.management.fields.skills", skill: "chat.piviManagementApproval.management.fields.skill",   catalogRevision: "chat.piviManagementApproval.management.fields.catalogRevision", icon: "chat.piviManagementApproval.management.fields.icon", prompt: "chat.piviManagementApproval.management.fields.prompt", before: "chat.piviManagementApproval.management.fields.before", after: "chat.piviManagementApproval.management.fields.after", module: "chat.piviManagementApproval.management.fields.module", title: "chat.piviManagementApproval.management.fields.title",
};

function field(t: TFunction, key: FieldKey, value: PiviManagementPlanField["value"]): PiviManagementPlanField {
  return { label: t(FIELD_KEYS[key]), value };
}
function fieldPush(fields: PiviManagementPlanField[], t: TFunction, key: FieldKey, value: PiviManagementPlanValue): void { fields.push(field(t, key, value)); }
function changeLine(t: TFunction, key: ChangeKey): string { return t(CHANGE_KEYS[key]); }
function booleanValue(t: TFunction, value: boolean): string { return t(value ? "chat.piviManagementApproval.management.values.yes" : "chat.piviManagementApproval.management.values.no"); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
function request(domain: "mcp" | "skills" | "commands" | "prompt", action: string, title: string, revision: string | number, changeLines: string[], fields: PiviManagementPlanField[]): PiviManagementApprovalRequest {
  return { domain, action, title, revision, changeLines, ...(fields.length ? { fields } : {}) };
}
