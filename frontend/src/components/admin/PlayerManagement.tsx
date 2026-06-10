import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Edit2, Trash2, X, Save, AlertCircle, Download, Upload } from 'lucide-react';
import axios from 'axios';
import TimezoneSelector from '../TimezoneSelector';
import { getSavedTimezone, generatePlayerTimeSlots, getTimezoneAbbr } from '../../utils/timezone';


interface Player {
  id: number;
  fid: string;
  game_name: string;
  construction_speedups_days: number;
  research_speedups_days: number;
  troop_training_speedups_days: number;
  general_speedups_days: number;
  fire_crystals: number;
  refined_fire_crystals: number;
  fire_crystal_shards: number;
  time_slots: string[];
  time_slots_by_day?: { construction: string[]; research: string[]; troop: string[] };
  monday_points: number;
  research_points: number;
  thursday_points: number;
  research_day?: string;
  avatar_image?: string;
  stove_lv?: number;
  stove_lv_content?: string;
  alliance?: string;
}

type SortField = 'game_name' | 'fid' | 'monday_points' | 'research_points' | 'thursday_points';
type SortDirection = 'asc' | 'desc';

export default function PlayerManagement() {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('game_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showFireCrystals, setShowFireCrystals] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [activeTimeTab, setActiveTimeTab] = useState<'construction' | 'research' | 'troop'>('construction');
  const [researchDay, setResearchDay] = useState('tuesday');
  const [timezone, setTimezone] = useState(getSavedTimezone);

  useEffect(() => {
    fetchPlayers();
    axios.get('/api/settings/show-fire-crystals')
      .then(res => setShowFireCrystals(res.data.show_fire_crystals))
      .catch(() => {});
    axios.get('/api/settings/research-day')
      .then(res => setResearchDay(res.data.research_day))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Mount-only initialization; fetchPlayers is recreated each render so adding it would cause a re-fetch loop.
  }, []);

  const researchDayName = t(`form.${researchDay === 'friday' ? 'fridayName' : 'tuesdayName'}`);
  const dayTypeLabel = (dayType: string) =>
    t(`form.${dayType}Times`, dayType === 'research' ? { day: researchDayName } : {});

  const fetchPlayers = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await axios.get('/api/admin/players', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPlayers(response.data);
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.fetchError');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredAndSortedPlayers = useMemo(() => {
    const filtered = players.filter(
      (player) =>
        player.game_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        player.fid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (player.alliance || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

    filtered.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [players, searchQuery, sortField, sortDirection]);

  const handleDelete = async (playerId: number) => {
    try {
      const token = localStorage.getItem('adminToken');
      await axios.delete(`/api/admin/player/${playerId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPlayers(players.filter((p) => p.id !== playerId));
      setShowDeleteConfirm(null);
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.deleteError');
      setError(msg);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingPlayer) return;

    try {
      const token = localStorage.getItem('adminToken');
      await axios.put(`/api/admin/player/${editingPlayer.id}`, editingPlayer, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchPlayers();
      setEditingPlayer(null);
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.playerUpdateError');
      setError(msg);
    }
  };

  const handleDeleteAll = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      await axios.delete('/api/admin/players/delete-all', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setPlayers([]);
      setShowDeleteAllConfirm(false);
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.deleteAllError');
      setError(msg);
    }
  };

  const handleExportJSON = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await axios.get('/api/admin/players/export-json', {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `players_backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.exportError');
      setError(msg);
    }
  };

  const handleImportJSON = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.players || !Array.isArray(data.players)) {
        setError(t('admin.importInvalidFile'));
        return;
      }

      const token = localStorage.getItem('adminToken');
      const response = await axios.post('/api/admin/players/import', data, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const { imported, updated, errors } = response.data;
      setImportMessage(t('admin.importSuccess', { imported, updated }) + (errors > 0 ? ` (${errors} errors)` : ''));
      await fetchPlayers();
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError(t('admin.importInvalidFile'));
      } else {
        const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.importError');
        setError(msg);
      }
    }
    // Reset the file input
    event.target.value = '';
  };

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-accent transition-colors"
    >
      {label}
      {sortField === field && (
        <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  );

  if (loading) {
    return (
      <div className="bg-dark-card rounded-xl border border-theme-border p-12 text-center">
        <p className="text-theme-dim">{t('form.loading')}</p>
      </div>
    );
  }

  return (
    <div className="bg-dark-card rounded-xl border border-theme-border p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-accent">{t('admin.playerManagement')}</h2>
          <p className="text-theme-dim mt-1">
            {t('admin.totalPlayers')}: {players.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJSON}
            className="flex items-center gap-2 px-4 py-2 bg-success text-dark-bg rounded-lg hover:bg-success/80 font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('admin.exportJSON')}
          </button>
          <label className="flex items-center gap-2 px-4 py-2 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors cursor-pointer">
            <Upload className="w-4 h-4" />
            {t('admin.importJSON')}
            <input
              type="file"
              accept=".json"
              onChange={handleImportJSON}
              className="hidden"
            />
          </label>
          {players.length > 0 && (
            <button
              onClick={() => setShowDeleteAllConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-danger text-white rounded-lg hover:bg-danger-dark font-medium transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {t('admin.removeAll')}
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-theme-dim w-5 h-5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.search')}
            className="w-full pl-10 pr-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
          />
        </div>
      </div>

      {/* Import Success Message */}
      {importMessage && (
        <div className="mb-6 p-4 bg-success/10 border border-success/30 rounded-lg flex items-center justify-between">
          <p className="text-success">{importMessage}</p>
          <button onClick={() => setImportMessage('')} className="text-success hover:text-success/70">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-danger" />
          <p className="text-danger">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-theme-border">
              <th className="text-left p-3 font-semibold text-theme-dim">
                <SortButton field="game_name" label={t('admin.gameName')} />
              </th>
              <th className="text-left p-3 font-semibold text-theme-dim">
                <SortButton field="fid" label="FID" />
              </th>
              <th className="text-center p-3 font-semibold text-theme-dim">
                <SortButton field="monday_points" label={t('admin.monday').split(' - ')[0]} />
              </th>
              <th className="text-center p-3 font-semibold text-theme-dim">
                <SortButton field="research_points" label={t(`admin.${players[0]?.research_day || 'tuesday'}`).split(' - ')[0]} />
              </th>
              <th className="text-center p-3 font-semibold text-theme-dim">
                <SortButton field="thursday_points" label={t('admin.thursday').split(' - ')[0]} />
              </th>
              <th className="text-center p-3 font-semibold text-theme-dim">{t('admin.timeSlots')}</th>
              <th className="text-center p-3 font-semibold text-theme-dim">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedPlayers.map((player) => (
              <tr key={player.id} className="border-b border-theme-border/50 hover:bg-dark-card-hover">
                <td className="p-3 text-theme-text">
                  <div className="flex items-center gap-2">
                    {player.avatar_image ? (
                      <img src={player.avatar_image} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                    ) : null}
                    {player.alliance && <span className="text-accent font-medium">[{player.alliance}]</span>} {player.game_name}
                  </div>
                </td>
                <td className="p-3 text-sm text-theme-dim">{player.fid}</td>
                <td className="p-3 text-center font-medium text-accent">
                  {player.monday_points.toLocaleString()}
                </td>
                <td className="p-3 text-center font-medium text-success">
                  {player.research_points.toLocaleString()}
                </td>
                <td className="p-3 text-center font-medium text-accent-light">
                  {player.thursday_points.toLocaleString()}
                </td>
                <td className="p-3 text-center text-sm text-theme-dim">
                  {player.time_slots ? player.time_slots.length : 0} {t('admin.selected')}
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => { setActiveTimeTab('construction'); setEditingPlayer(player); }}
                      className="p-2 text-accent hover:bg-accent/10 rounded-lg transition-colors"
                      title={t('admin.edit')}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(player.id)}
                      className="p-2 text-danger hover:bg-danger/10 rounded-lg transition-colors"
                      title={t('admin.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredAndSortedPlayers.length === 0 && (
          <div className="text-center py-12 text-theme-dim">
            {t('admin.noPlayersFound')}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingPlayer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-dark-card rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-theme-border">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-bold text-accent">{t('admin.editPlayer')}</h3>
              <button
                onClick={() => setEditingPlayer(null)}
                className="text-theme-dim hover:text-theme-text"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-theme-text mb-2">{t('admin.gameName')}</label>
                  <input
                    type="text"
                    value={editingPlayer.game_name}
                    onChange={(e) =>
                      setEditingPlayer({ ...editingPlayer, game_name: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-dark-input border border-theme-border rounded-lg text-theme-text focus:ring-2 focus:ring-accent focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text mb-2">{t('admin.allianceLabel')}</label>
                  <input
                    type="text"
                    value={editingPlayer.alliance || ''}
                    onChange={(e) =>
                      setEditingPlayer({ ...editingPlayer, alliance: e.target.value.toUpperCase().slice(0, 3) })
                    }
                    maxLength={3}
                    className="w-full px-4 py-2 bg-dark-input border border-theme-border rounded-lg text-theme-text focus:ring-2 focus:ring-accent focus:border-accent uppercase"
                    placeholder="TAG"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'construction_speedups_days', label: t('admin.constructionDays') },
                  { key: 'research_speedups_days', label: t('admin.researchDays') },
                  { key: 'troop_training_speedups_days', label: t('admin.troopDays') },
                  { key: 'general_speedups_days', label: t('admin.generalDays') },
                  ...(showFireCrystals ? [
                    { key: 'fire_crystals', label: t('form.fireCrystals') },
                    { key: 'refined_fire_crystals', label: t('form.refinedFireCrystals') },
                    { key: 'fire_crystal_shards', label: t('form.fireCrystalShards') },
                  ] : []),
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-theme-text mb-2">{label}</label>
                    <input
                      type="number"
                      value={editingPlayer[key as keyof Player] as number}
                      onChange={(e) =>
                        setEditingPlayer({
                          ...editingPlayer,
                          [key]: parseFloat(e.target.value) || 0,
                        })
                      }
                      min="0"
                      step={key.includes('speedups') ? '0.1' : '1'}
                      className="w-full px-4 py-2 bg-dark-input border border-theme-border rounded-lg text-theme-text focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>
                ))}
              </div>

              {/* Time Preferences */}
              <div className="mt-6">
                <label className="block text-sm font-medium text-theme-text mb-2">
                  {t('form.timePreferences')}
                </label>

                {/* Day type tabs */}
                <div className="flex gap-2 mb-3 border-b border-theme-border">
                  {(['construction', 'research', 'troop'] as const).map((dayType) => {
                    const slots = editingPlayer.time_slots_by_day?.[dayType] || [];
                    return (
                      <button
                        key={dayType}
                        type="button"
                        onClick={() => setActiveTimeTab(dayType)}
                        className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
                          activeTimeTab === dayType
                            ? 'border-accent text-accent'
                            : 'border-transparent text-theme-dim hover:text-theme-text'
                        }`}
                      >
                        {dayTypeLabel(dayType)}
                        {slots.length > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-accent/20 text-accent">
                            {slots.length}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between mb-2">
                  <TimezoneSelector value={timezone} onChange={setTimezone} />
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {generatePlayerTimeSlots(timezone).map(({ display, utcValue }) => {
                    const byDay = editingPlayer.time_slots_by_day || { construction: [], research: [], troop: [] };
                    const current = byDay[activeTimeTab] || [];
                    return (
                      <button
                        key={utcValue}
                        type="button"
                        onClick={() => {
                          setEditingPlayer({
                            ...editingPlayer,
                            time_slots_by_day: {
                              ...byDay,
                              [activeTimeTab]: current.includes(utcValue)
                                ? current.filter((t: string) => t !== utcValue)
                                : [...current, utcValue],
                            },
                          });
                        }}
                        className={`p-2 rounded border text-sm font-medium transition-all ${
                          current.includes(utcValue)
                            ? 'bg-accent border-accent text-dark-bg'
                            : 'bg-dark-input border-theme-border text-theme-text hover:border-accent'
                        }`}
                      >
                        {display}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-theme-dim mt-2">
                  {t('form.selectedSlots', { count: (editingPlayer.time_slots_by_day?.[activeTimeTab] || []).length })}
                  {timezone !== 'UTC' && (
                    <span className="ml-2 text-accent">
                      ({t('form.timesShownIn')} {getTimezoneAbbr(timezone)})
                    </span>
                  )}
                </p>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium"
                >
                  <Save className="w-5 h-5" />
                  {t('common.save')}
                </button>
                <button
                  onClick={() => setEditingPlayer(null)}
                  className="flex-1 px-4 py-3 bg-dark-bg text-theme-text rounded-lg hover:bg-dark-card-hover font-medium border border-theme-border"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-dark-card rounded-xl p-6 max-w-md w-full border border-theme-border">
            <h3 className="text-xl font-bold text-theme-text mb-4">{t('admin.confirmDelete')}</h3>
            <div className="flex gap-3">
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="flex-1 px-4 py-3 bg-danger text-white rounded-lg hover:bg-danger-dark font-medium"
              >
                {t('common.yes')}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 px-4 py-3 bg-dark-bg text-theme-text rounded-lg hover:bg-dark-card-hover font-medium border border-theme-border"
              >
                {t('common.no')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteAllConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-dark-card rounded-xl p-6 max-w-md w-full border border-theme-border">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-8 h-8 text-danger" />
              <h3 className="text-xl font-bold text-theme-text">{t('admin.removeAllConfirm')}</h3>
            </div>
            <p className="text-theme-dim mb-6">
              {t('admin.removeAllWarning', { count: players.length })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteAll}
                className="flex-1 px-4 py-3 bg-danger text-white rounded-lg hover:bg-danger-dark font-medium"
              >
                {t('admin.yesDeleteAll')}
              </button>
              <button
                onClick={() => setShowDeleteAllConfirm(false)}
                className="flex-1 px-4 py-3 bg-dark-bg text-theme-text rounded-lg hover:bg-dark-card-hover font-medium border border-theme-border"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
