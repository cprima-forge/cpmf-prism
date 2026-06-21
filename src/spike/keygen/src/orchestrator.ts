import * as https from 'https';
import { execSync } from 'child_process';

export interface OrchestratorLicense {
    IsRegistered: boolean;
    IsCommunity: boolean;
    IsProOrEnterprise: boolean;
    SubscriptionCode: string;
    SubscriptionPlan: string;
    IsExpired: boolean;
}

export interface OrchestratorUser {
    Key: string;                      // UUID — primary stable identifier
    DirectoryIdentifier: string | null; // IdP object ID — most stable under SSO
    TenantKey: string | null;         // tenant UUID — scope qualifier
    Id: number;                       // DB row ID — informational only
    UserName: string;
    Name: string;
    Surname: string;
    EmailAddress: string;
    IsActive: boolean;
}

export interface OrchestratorData {
    license: OrchestratorLicense;
    user: OrchestratorUser;
}

interface AuthData {
    AccessToken: string;
    BaseUrl: string;
    OrganizationId: string;
    TenantName: string;
}

function httpsGet<T>(url: string, token: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        }, res => {
            let raw = '';
            res.on('data', c => (raw += c));
            res.on('end', () => {
                if ((res.statusCode ?? 0) >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
                    return;
                }
                try { resolve(JSON.parse(raw) as T); }
                catch { reject(new Error('parse error: ' + raw.slice(0, 120))); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function getAuthData(log: (msg: string) => void): AuthData {
    log('[orch] fetching auth via uip CLI');
    const raw = execSync('uip login refresh --output json', { timeout: 10_000, encoding: 'utf-8' });
    return JSON.parse(raw).Data as AuthData;
}

export async function getOrchestratorData(
    log: (msg: string) => void,
): Promise<OrchestratorData> {
    const auth = getAuthData(log);
    const base = `${auth.BaseUrl}/${auth.OrganizationId}/${auth.TenantName}/orchestrator_/odata`;

    const licenseUrl = `${base}/Settings/UiPath.Server.Configuration.OData.GetLicense`;
    const userUrl    = `${base}/Users/UiPath.Server.Configuration.OData.GetCurrentUser`;

    log(`[orch] GET ${licenseUrl}`);
    log(`[orch] GET ${userUrl}`);

    const [rawLicense, rawUser] = await Promise.all([
        httpsGet<Record<string, unknown>>(licenseUrl, auth.AccessToken),
        httpsGet<Record<string, unknown>>(userUrl,    auth.AccessToken),
    ]);

    const license: OrchestratorLicense = {
        IsRegistered:      rawLicense['IsRegistered']      as boolean,
        IsCommunity:       rawLicense['IsCommunity']       as boolean,
        IsProOrEnterprise: rawLicense['IsProOrEnterprise'] as boolean,
        SubscriptionCode:  rawLicense['SubscriptionCode']  as string,
        SubscriptionPlan:  rawLicense['SubscriptionPlan']  as string,
        IsExpired:         rawLicense['IsExpired']          as boolean,
    };

    const user: OrchestratorUser = {
        Key:                 rawUser['Key']                 as string          ?? '',
        DirectoryIdentifier: rawUser['DirectoryIdentifier'] as string  | null ?? null,
        TenantKey:           rawUser['TenantKey']           as string  | null ?? null,
        Id:                  rawUser['Id']                  as number          ?? 0,
        UserName:            rawUser['UserName']            as string          ?? '',
        Name:                rawUser['Name']                as string          ?? '',
        Surname:             rawUser['Surname']             as string          ?? '',
        EmailAddress:        rawUser['EmailAddress']        as string          ?? '',
        IsActive:            rawUser['IsActive']            as boolean         ?? false,
    };

    log(`[orch] license plan=${license.SubscriptionPlan} community=${license.IsCommunity}`);
    log(`[orch] user=${user.UserName} key=${user.Key} tenantKey=${user.TenantKey ?? 'n/a'}`);

    return { license, user };
}
