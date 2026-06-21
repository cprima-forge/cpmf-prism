# Extension Activation Sequence

```mermaid
sequenceDiagram
    participant Studio as UiPath Studio
    participant Ext    as Extension Host (activate)
    participant Inter  as uipath.interop.hasService
    participant Reg    as Registry / Filesystem
    participant Keygen as Keygen.sh API
    participant UIP    as uip CLI
    participant Orch   as Orchestrator API
    participant Tree   as RuntimeTreeProvider

    Studio->>Ext: activate()
    Ext->>Ext: createOutputChannel / StatusBarItem / TreeProvider
    Ext->>Ext: log ext=v0.1.x VSCode=x.y platform=win32

    par host detection
        Ext->>Inter: executeCommand('uipath.interop.hasService', 'IStudioInteropService')
        Inter-->>Ext: null (no throw) → isUiPathStudio=true
    and machine identity
        Ext->>Reg: readRegistry('MachineId')
        Ext->>Reg: readText(ProgramData/machine.id)
        Ext->>Reg: readText(LocalAppData/machine.id)
        Reg-->>Ext: consensus UUID
        Ext->>Reg: backfill missing stores
    end

    Ext->>Keygen: POST /licenses/actions/validate-key {key, fingerprint, policy, product}
    Keygen-->>Ext: {valid, code, expiry, machineCount}

    alt code == FINGERPRINT_SCOPE_MISMATCH
        Ext->>Keygen: POST /machines {fingerprint, licenseId}
        Keygen-->>Ext: 201 Created
        Ext->>Keygen: POST /licenses/actions/validate-key (re-validate)
        Keygen-->>Ext: {valid=true}
    end

    Ext->>Tree: update(snapshot)
    Tree-->>Studio: render tree

    alt isUiPathStudio == true
        loop up to 5 attempts (3s / 6s / 12s / 24s backoff)
            Ext->>UIP: execSync('uip login refresh --output json')
            UIP-->>Ext: {AccessToken, BaseUrl, OrganizationId, TenantName}
            Ext->>Orch: GET /{org}/{tenant}/orchestrator_/odata/Settings/.../GetLicense
            Orch-->>Ext: {SubscriptionPlan, IsCommunity, IsProOrEnterprise, ...}
            Ext->>Tree: update(snapshot + orchLicense)
            Tree-->>Studio: render tree with License (Orchestrator) section
        end
    end
```

## Notes

- `isUiPathStudio` detection: command exists in Studio (returns `null`, no throw); throws in VS Code.
- Keygen machine activation only runs when `code == FINGERPRINT_SCOPE_MISMATCH` — once per machine per license key.
- Orchestrator fetch is **auto** in Studio (silent retries), **manual** via `$(plug)` button in VS Code.
- Tree renders once after `runLicenseCheck`; Orchestrator section populates asynchronously on success.
- All auth for Orchestrator comes from `uip` CLI — no credentials stored in extension.
