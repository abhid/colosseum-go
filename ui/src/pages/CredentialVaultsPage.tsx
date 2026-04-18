import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Card, EmptyState, ErrorBanner, LoadingState, QueryErrorState, SectionTitle } from '../components/Common'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../lib/tokens'
import { api } from '../lib/api'
import { queryKeys } from '../lib/queryKeys'

const INPUT_CLASSES = `h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm transition-colors focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 ${FOCUS_RING}`

export function CredentialVaultsPage() {
  const qc = useQueryClient()
  const vaults = useQuery({ queryKey: queryKeys.credentialVaults, queryFn: api.listCredentialVaults })
  const secrets = useQuery({ queryKey: queryKeys.secrets, queryFn: api.listSecrets })
  const [name, setName] = useState('default-vault')
  const [description, setDescription] = useState('General integration credentials')
  const [selectedVaultID, setSelectedVaultID] = useState('')
  const [selectedSecretName, setSelectedSecretName] = useState('')
  const [secretAlias, setSecretAlias] = useState('')
  const [newSecretName, setNewSecretName] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const [secretError, setSecretError] = useState('')
  const [vaultBindingError, setVaultBindingError] = useState('')

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
    queryKey: queryKeys.credentialVaultItems(selectedVaultID),
    queryFn: () => api.listCredentialVaultItems(selectedVaultID),
    enabled: Boolean(selectedVaultID),
  })

  const createVault = useMutation({
    mutationFn: () => api.createCredentialVault({ name, description }),
    onSuccess: () => {
      setVaultBindingError('')
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaults })
    },
  })
  const deleteVault = useMutation({
    mutationFn: (id: string) => api.deleteCredentialVault(id),
    onSuccess: () => {
      setVaultBindingError('')
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaults })
    },
  })
  const createSecret = useMutation({
    mutationFn: () => {
      const trimmedName = newSecretName.trim()
      const value = newSecretValue
      if (!trimmedName) throw new Error('Secret name is required')
      if (!value.trim()) throw new Error('Secret value is required')
      return api.createSecret({ name: trimmedName, value })
    },
    onSuccess: () => {
      setSecretError('')
      setNewSecretValue('')
      qc.invalidateQueries({ queryKey: queryKeys.secrets })
    },
  })
  const deleteSecret = useMutation({
    mutationFn: (n: string) => api.deleteSecret(n),
    onSuccess: () => {
      setSecretError('')
      qc.invalidateQueries({ queryKey: queryKeys.secrets })
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaultItems(selectedVaultID) })
    },
  })
  const addVaultItem = useMutation({
    mutationFn: () => api.upsertCredentialVaultItem(selectedVaultID, { secret_name: selectedSecretName, alias: secretAlias.trim() }),
    onSuccess: () => {
      setVaultBindingError('')
      setSecretAlias('')
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaultItems(selectedVaultID) })
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaults })
    },
  })
  const deleteVaultItem = useMutation({
    mutationFn: (secretName: string) => api.deleteCredentialVaultItem(selectedVaultID, secretName),
    onSuccess: () => {
      setVaultBindingError('')
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaultItems(selectedVaultID) })
      qc.invalidateQueries({ queryKey: queryKeys.credentialVaults })
    },
  })

  return (
    <div className="space-y-4">
      <SectionTitle title="Credential Vaults" subtitle="Group existing secrets and control session secret scope." />
      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Create Vault</h3>
        <label htmlFor="vault-name" className="sr-only">Vault name</label>
        <input
          id="vault-name"
          className={INPUT_CLASSES}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Vault name"
        />
        <label htmlFor="vault-desc" className="sr-only">Description</label>
        <input
          id="vault-desc"
          className={`${INPUT_CLASSES} mt-3`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
        />
        <div className="mt-4">
          <Button
            disabled={createVault.isPending}
            onClick={() => createVault.mutate()}
          >
            {createVault.isPending ? 'Creating…' : 'Create Vault'}
          </Button>
        </div>
        <ErrorBanner className="mt-2" title="Couldn't create vault" message={createVault.error ? (createVault.error as Error).message : undefined} />
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Secrets</h3>
        <p className="mb-3 text-xs text-gray-500">
          Secrets are encrypted at rest and injected into runs as environment variables through vault bindings.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <label htmlFor="secret-name" className="sr-only">Secret name</label>
            <input
              id="secret-name"
              className={INPUT_CLASSES}
              value={newSecretName}
              onChange={(e) => setNewSecretName(e.target.value)}
              placeholder="Secret name (example: OPENAI_API_KEY)"
            />
          </div>
          <div>
            <label htmlFor="secret-value" className="sr-only">Secret value</label>
            <input
              id="secret-value"
              className={INPUT_CLASSES}
              type="password"
              value={newSecretValue}
              onChange={(e) => setNewSecretValue(e.target.value)}
              placeholder="Secret value"
            />
          </div>
        </div>
        <div className="mt-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={createSecret.isPending}
            onClick={async () => {
              setSecretError('')
              try {
                await createSecret.mutateAsync()
              } catch (err) {
                setSecretError(err instanceof Error ? err.message : 'Failed to create secret')
              }
            }}
          >
            {createSecret.isPending ? 'Saving…' : 'Save Secret'}
          </Button>
        </div>
        <ErrorBanner className="mt-2" title="Couldn't save secret" message={secretError} />
        <QueryErrorState className="mt-2" title="Failed to load secrets" query={secrets} />
        <div className="mt-3 space-y-1">
          {(secrets.data ?? []).length === 0 ? <p className="text-xs text-gray-500">No secrets yet. Add one to bind it into a vault.</p> : null}
          {(secrets.data ?? []).map((secret) => (
            <div key={String(secret.name)} className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{String(secret.name)}</p>
                <p className="text-gray-500">Updated {new Date(String(secret.updated_at || secret.created_at)).toLocaleString()}</p>
              </div>
              <Button
                size="sm"
                variant="danger"
                disabled={deleteSecret.isPending}
                onClick={async () => {
                  setSecretError('')
                  try {
                    await deleteSecret.mutateAsync(String(secret.name))
                  } catch (err) {
                    setSecretError(err instanceof Error ? err.message : 'Failed to delete secret')
                  }
                }}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Vaults</h3>
        {vaults.isLoading ? <LoadingState label="Loading vaults…" /> : null}
        <QueryErrorState title="Failed to load vaults" query={vaults} />
        {!vaults.isLoading && !vaults.isError && (vaults.data ?? []).length === 0 ? <EmptyState title="No vaults" body="Create vaults to group secrets for runs." /> : null}
        <div className="space-y-2">
          {(vaults.data ?? []).map((vault) => (
            <div key={String(vault.id)} className={`rounded-md border p-3 text-sm transition-colors ${selectedVaultID === String(vault.id) ? 'border-gray-400 bg-gray-50' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <button
                  className={`min-w-0 text-left rounded ${FOCUS_RING}`}
                  onClick={() => setSelectedVaultID(String(vault.id))}
                  aria-pressed={selectedVaultID === String(vault.id)}
                >
                  <p className="truncate font-medium text-gray-900">{String(vault.name)}</p>
                  <p className="text-xs text-gray-500">{String(vault.description || '')}</p>
                </button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deleteVault.isPending}
                  onClick={() => deleteVault.mutate(String(vault.id))}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {selectedVaultID ? (
        <Card>
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-gray-900">Vault Secret Bindings</h3>
          <p className="mb-2 text-xs text-gray-500">
            Each binding becomes an env var in the session. If alias is empty, the secret name is used as the env var key.
          </p>
          <ErrorBanner className="mb-2" title="Couldn't bind secret" message={vaultBindingError} />
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <label htmlFor="binding-secret" className="sr-only">Secret</label>
              <select
                id="binding-secret"
                className={INPUT_CLASSES}
                value={selectedSecretName}
                onChange={(e) => setSelectedSecretName(e.target.value)}
              >
                {(secrets.data ?? []).map((secret) => (
                  <option key={String(secret.name)} value={String(secret.name)}>{String(secret.name)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="binding-alias" className="sr-only">Alias</label>
              <input
                id="binding-alias"
                className={INPUT_CLASSES}
                value={secretAlias}
                placeholder="Alias (optional)"
                onChange={(e) => setSecretAlias(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedSecretName || addVaultItem.isPending}
              onClick={async () => {
                setVaultBindingError('')
                try {
                  await addVaultItem.mutateAsync()
                } catch (err) {
                  setVaultBindingError(err instanceof Error ? err.message : 'Failed to bind secret to vault')
                }
              }}
            >
              Add Secret to Vault
            </Button>
          </div>
          {(secrets.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">No secrets available. Add secrets via API before binding them to a vault.</p>
          ) : null}
          <QueryErrorState className="mt-2" title="Failed to load vault items" query={vaultItems} />
          <div className="mt-3 space-y-1">
            {(vaultItems.data ?? []).length === 0 ? <p className="text-xs text-gray-500">No secrets bound to this vault yet.</p> : null}
            {(vaultItems.data ?? []).map((item) => (
              <div key={`${String(item.vault_id)}-${String(item.secret_name)}`} className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs">
                <span>{String(item.secret_name)} {String(item.alias || '') ? <span className="text-gray-500">as {String(item.alias)}</span> : null}</span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={deleteVaultItem.isPending}
                  onClick={async () => {
                    setVaultBindingError('')
                    try {
                      await deleteVaultItem.mutateAsync(String(item.secret_name))
                    } catch (err) {
                      setVaultBindingError(err instanceof Error ? err.message : 'Failed to remove vault binding')
                    }
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
