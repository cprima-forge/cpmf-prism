import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { RuntimeSnapshot } from './diagnostics';

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://cpmforge.dev/schemas/cpmf-platform-snapshot.schema.json',
  title: 'CPMForge Platform Snapshot',
  type: 'object',
  required: ['schema_version', 'timestamp', 'runtime', 'machine', 'extensions'],
  properties: {
    schema_version: { type: 'string', const: 'v0.1.0' },
    timestamp:      { type: 'string', format: 'date-time' },
    runtime: {
      type: 'object', required: ['host'],
      properties: {
        host:               { type: 'string', enum: ['uips-desktop', 'vscode'] },
        platform:           { type: 'string' },
        hostname:           { type: 'string' },
        vscode_api_version: { type: 'string' },
      },
      additionalProperties: false,
    },
    machine: {
      type: 'object', required: ['id'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        id_sources: {
          type: 'object',
          properties: {
            registry:       { type: ['string', 'null'] },
            program_data:   { type: ['string', 'null'] },
            local_app_data: { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
        registry: {
          type: 'object',
          properties: {
            hklm_reachable: { type: 'boolean' },
            machine_id:     { type: ['string', 'null'] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    orchestrator_license: {
      type: 'object', required: ['available'],
      properties: {
        available:            { type: 'boolean' },
        subscription_plan:    { type: ['string', 'null'] },
        subscription_code:    { type: ['string', 'null'] },
        is_community:         { type: ['boolean', 'null'] },
        is_pro_or_enterprise: { type: ['boolean', 'null'] },
        current_user: {
          type: 'object',
          properties: {
            key:                  { type: 'string', format: 'uuid' },
            directory_identifier: { type: ['string', 'null'] },
            tenant_key:           { type: ['string', 'null'] },
            username:             { type: ['string', 'null'] },
            id:                   { type: ['integer', 'null'] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    extensions: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'version'],
        properties: {
          id:      { type: 'string' },
          version: { type: 'string' },
          license: {
            type: 'object', required: ['valid'],
            properties: {
              valid:        { type: 'boolean' },
              expires_at:   { type: ['string', 'null'], format: 'date-time' },
              source:       { type: 'string', enum: ['api', 'file'] },
              entitlements: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  if:   { properties: { runtime: { properties: { host: { const: 'uips-desktop' } }, required: ['host'] } }, required: ['runtime'] },
  then: { required: ['orchestrator_license'] },
  additionalProperties: false,
};

export interface SchemaReport {
    valid: boolean;
    errors: string[];
    snapshot: object;
}

export function buildSchemaSnapshot(s: RuntimeSnapshot): object {
    const orchAvailable = s.orchLicense !== null;

    const orchSection: Record<string, unknown> = {
        available:            orchAvailable,
        subscription_plan:    s.orchLicense?.SubscriptionPlan    ?? null,
        subscription_code:    s.orchLicense?.SubscriptionCode    ?? null,
        is_community:         s.orchLicense?.IsCommunity         ?? null,
        is_pro_or_enterprise: s.orchLicense?.IsProOrEnterprise   ?? null,
    };

    if (s.orchUser) {
        orchSection['current_user'] = {
            key:                  s.orchUser.Key                 || null,
            directory_identifier: s.orchUser.DirectoryIdentifier ?? null,
            tenant_key:           s.orchUser.TenantKey           ?? null,
            username:             s.orchUser.UserName            || null,
            id:                   s.orchUser.Id                  ?? null,
        };
    }

    return {
        schema_version: 'v0.1.0',
        timestamp:      s.timestamp,
        runtime: {
            host:               s.host,
            platform:           s.platform,
            hostname:           s.hostname,
            vscode_api_version: s.vscodeVersion,
        },
        machine: {
            id: s.machine.id,
            id_sources: {
                registry:       s.machine.idFromRegistry     ?? null,
                program_data:   s.machine.idFromProgramData  ?? null,
                local_app_data: s.machine.idFromLocalAppData ?? null,
            },
            registry: {
                hklm_reachable: s.registry.hklmReachable,
                machine_id:     s.registry.machineId ?? null,
            },
        },
        orchestrator_license: orchSection,
        extensions: s.extensions.map(e => ({
            id:      e.id,
            version: e.version,
            ...(e.keygen_license ? {
                license: {
                    valid:        e.keygen_license.valid,
                    expires_at:   e.keygen_license.expires_at ?? null,
                    source:       'api' as const,
                    entitlements: (e.keygen_license.entitlements ?? []) as string[],
                },
            } : {}),
        })),
    };
}

const _ajv = new Ajv2020({ allErrors: true });
addFormats(_ajv);
const _validate = _ajv.compile(SCHEMA);

export function validateSnapshot(s: RuntimeSnapshot): SchemaReport {
    const snapshot = buildSchemaSnapshot(s);
    const valid    = _validate(snapshot) as boolean;
    const errors   = valid
        ? []
        : (_validate.errors ?? []).map(e => `${e.instancePath || '(root)'} ${e.message}`);
    return { valid, errors, snapshot };
}
