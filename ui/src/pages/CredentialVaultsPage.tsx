import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Card, EmptyState, SectionTitle } from '../components/Common'
import { api } from '../lib/api'

export function CredentialVaultsPage() {
  const qc = useQueryClient()
  const vaults = useQuery({ queryKey: ['ecosystem', 'credential-vaults'], queryFn: api.listCredentialVaults })
  const secrets = useQuery({ queryKey: ['ecosystem', 'secrets'], queryFn: api.listSecrets })
  const [name, setName] = useState('default-vault')
  const [description, setDescription] = useState('General integration credentials')
  const [selectedVaultID, setSelectedVaultID] = useState('')
  const [selectedSecretName, setSelectedSecretName] = useState('')
  const [secretAlias, setSecretAlias] = useState('')

  useEffect(() => {
    const firstVaultID = String((vaults.data ?? [])[0]?.id ?? '')
    if (!firstVaultID) return
    if (!selectedVaultID) setSelectedVaultID(firstVaultID)
  }, [vaults.data, selectedVaultID])

  useEffect(() => {
    const firstSecret = String((secrets.data ?? [])[0]?.name ?? '')
    if (!firstSecret) return
    if (!selectedSecretName) setSelectedSecretName(firstSecret)
  }, [secrets.data, selectedSecretName])

  const vaultItems = useQuery({
    queryKey: ['ecosystem', 'credential-vaults', selectedVaultID, 'items'],
    queryFn: () => api.listCredentialVaultItems(selectedVaultID),
    enabled: Boolean(selectedVaultID),
  })

  const createVault = useMutation({
    mutationFn: () => api.createCredentialVault({ name, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'credential-vaults'] }),
  })
  const deleteVault = useMutation({
    mutationFn: (id: string) => api.deleteCredentialVault(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'credential-vaults'] }),
  })
  const addVaultItem = useMutation({
    mutationFn: () => api.upsertCredentialVaultItem(selectedVaultID, { secret_name: selectedSecretName, alias: secretAlias }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'credential-vaults', selectedVaultID, 'items'] }),
  })
  const deleteVaultItem = useMutation({
    mutationFn: (secretName: string) => api.deleteCredentialVaultItem(selectedVaultID, secretName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ecosystem', 'credential-vaults', selectedVaultID, 'items'] }),
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Credential Vaults" subtitle="Group existing secrets and control session secret scope." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Create Vault</h3>
        <input
          className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vault name"
        />
        <input
          className="mt-3 h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
        />
        <button
          className="mt-4 h-9 rounded-md bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
          disabled={createVault.isPending}
          onClick={() => createVault.mutate()}
        >
          {createVault.isPending ? 'Creating...' : 'Create Vault'}
        </button>
        {createVault.error ? <p className="mt-2 text-sm text-red-600">{String(createVault.error)}</p> : null}
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Vaults</h3>
        {(vaults.data ?? []).length === 0 ? <EmptyState title="No vaults" body="Create vaults to group secrets for sessions." /> : null}
        <div className="space-y-2">
          {(vaults.data ?? []).map((vault) => (
            <div key={String(vault.id)} className={`rounded border p-2 text-sm ${selectedVaultID === String(vault.id) ? 'border-gray-400 bg-gray-50' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <button className="min-w-0 text-left" onClick={() => setSelectedVaultID(String(vault.id))}>
                  <p className="truncate font-medium text-gray-900">{String(vault.name)}</p>
                  <p className="text-xs text-gray-500">{String(vault.description || '')}</p>
                </button>
                <button
                  className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                  disabled={deleteVault.isPending}
                  onClick={() => deleteVault.mutate(String(vault.id))}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {selectedVaultID ? (
        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Vault Secret Bindings</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <select
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              value={selectedSecretName}
              onChange={(e) => setSelectedSecretName(e.target.value)}
            >
              {(secrets.data ?? []).map((secret) => (
                <option key={String(secret.name)} value={String(secret.name)}>{String(secret.name)}</option>
              ))}
            </select>
            <input
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400"
              value={secretAlias}
              placeholder="Alias (optional)"
              onChange={(e) => setSecretAlias(e.target.value)}
            />
          </div>
          <button
            className="mt-2 h-8 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            disabled={!selectedSecretName || addVaultItem.isPending}
            onClick={() => addVaultItem.mutate()}
          >
            Add Secret to Vault
          </button>
          {(secrets.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No secrets available. Add secrets via API before binding them to a vault.</p>
          ) : null}
          <div className="mt-3 space-y-1">
            {(vaultItems.data ?? []).length === 0 ? <p className="text-xs text-gray-500">No secrets bound to this vault yet.</p> : null}
            {(vaultItems.data ?? []).map((item) => (
              <div key={`${String(item.vault_id)}-${String(item.secret_name)}`} className="flex items-center justify-between rounded border border-gray-200 bg-white px-2 py-1.5 text-xs">
                <span>{String(item.secret_name)} {String(item.alias || '') ? <span className="text-gray-500">as {String(item.alias)}</span> : null}</span>
                <button
                  className="rounded border border-red-200 px-2 py-0.5 font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                  disabled={deleteVaultItem.isPending}
                  onClick={() => deleteVaultItem.mutate(String(item.secret_name))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
