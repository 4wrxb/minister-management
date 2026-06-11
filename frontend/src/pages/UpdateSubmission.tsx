import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, ArrowLeft, Save, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';
import axios from 'axios';
import TimezoneSelector from '../components/TimezoneSelector';
import { getSavedTimezone, generatePlayerTimeSlots, getTimezoneAbbr, formatTimeInTimezone } from '../utils/timezone';
import { LOOTBAR_URL } from '../utils/affiliate';

interface PlayerData {
  id?: number;
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
  timezone?: string;
  avatar_image?: string;
  stove_lv?: number;
  stove_lv_content?: string;
  alliance?: string;
}

export default function UpdateSubmission() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchFid, setSearchFid] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [playerData, setPlayerData] = useState<PlayerData | null>(null);
  const [showFireCrystals, setShowFireCrystals] = useState(false);
  const [activeTimeTab, setActiveTimeTab] = useState<'construction' | 'research' | 'troop'>('construction');
  const [researchDay, setResearchDay] = useState('tuesday');
  const [timezone, setTimezone] = useState(getSavedTimezone);
  const [heatmapData, setHeatmapData] = useState<Record<string, Record<string, number>>>({});
  const [playerAssignments, setPlayerAssignments] = useState<Record<string, {time_slot: string}[]> | null>(null);

  useEffect(() => {
    axios.get('/api/settings/show-fire-crystals')
      .then(res => setShowFireCrystals(res.data.show_fire_crystals))
      .catch(() => {});
    axios.get('/api/settings/research-day')
      .then(res => setResearchDay(res.data.research_day))
      .catch(() => {});
    axios.get('/api/time-preferences/heatmap')
      .then(res => setHeatmapData(res.data))
      .catch(() => {});
  }, []);

  const researchDayName = t(`form.${researchDay === 'friday' ? 'fridayName' : 'tuesdayName'}`);
  const dayTypeLabel = (dayType: string) =>
    t(`form.${dayType}Times`, dayType === 'research' ? { day: researchDayName } : {});

  const timeSlotOptions = generatePlayerTimeSlots(timezone);

  const handleSearch = async () => {
    if (!searchFid.trim()) {
      setError(t('form.enterPlayerID'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await axios.get(`/api/player/${searchFid}`);
      const data = response.data;
      // Ensure time_slots_by_day exists (fallback from legacy time_slots)
      if (!data.time_slots_by_day) {
        data.time_slots_by_day = {
          construction: data.time_slots || [],
          research: data.time_slots || [],
          troop: data.time_slots || [],
        };
      }
      // If player has a saved timezone, use it
      if (data.timezone) {
        setTimezone(data.timezone);
      }
      setPlayerData(data);
      // Fetch player's current assignments
      try {
        const assignRes = await axios.get(`/api/player/${searchFid}/assignments`);
        setPlayerAssignments(assignRes.data.assignments || null);
      } catch {
        setPlayerAssignments(null);
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        setError(t('update.notFound'));
      } else {
        const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('form.errorOccurred');
        setError(msg);
      }
      setPlayerData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!playerData) return;

    const { name, value } = e.target;
    setPlayerData(prev => ({
      ...prev!,
      [name]: name === 'game_name' || name === 'fid' || name === 'alliance' ? value : parseFloat(value) || 0,
    }));
  };

  const toggleTimeSlot = (time: string) => {
    if (!playerData) return;

    const byDay = playerData.time_slots_by_day || { construction: [], research: [], troop: [] };
    const current = byDay[activeTimeTab] || [];
    setPlayerData(prev => ({
      ...prev!,
      time_slots_by_day: {
        ...byDay,
        [activeTimeTab]: current.includes(time)
          ? current.filter(t => t !== time)
          : [...current, time],
      },
    }));
  };

  const handleUpdate = async () => {
    if (!playerData) return;

    // Alliance is required
    if (!playerData.alliance || !playerData.alliance.trim()) {
      setError(t('form.allianceRequired'));
      return;
    }

    // Warn if no time slots selected for any day type
    const byDay = playerData.time_slots_by_day || { construction: [], research: [], troop: [] };
    const totalSlots = byDay.construction.length + byDay.research.length + byDay.troop.length;
    if (totalSlots === 0) {
      if (!window.confirm(t('form.noTimeSlotsConfirm'))) {
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      await axios.post('/api/player/submit', {
        ...playerData,
        time_slots_by_day: playerData.time_slots_by_day,
        timezone,
      });
      setSuccess(true);
      setTimeout(() => {
        navigate('/');
      }, 2000);
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('form.updateError');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-dark-card rounded-2xl p-12 border border-theme-border max-w-md w-full text-center">
          <CheckCircle className="w-20 h-20 text-success mx-auto mb-6" />
          <h2 className="text-3xl font-bold text-accent mb-4">{t('form.success')}</h2>
          <p className="text-theme-dim">{t('form.updateSuccess')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-dark-card rounded-2xl p-8 border border-theme-border max-w-4xl w-full">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-theme-dim hover:text-theme-text mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          {t('update.backHome')}
        </button>

        <h2 className="text-3xl font-bold text-accent mb-6 text-center">
          {t('update.title')}
        </h2>

        {!playerData ? (
          <div>
            <p className="text-theme-dim text-center mb-6">{t('update.enterFID')}</p>
            <div className="flex gap-4">
              <input
                type="text"
                value={searchFid}
                onChange={(e) => setSearchFid(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t('update.fidLabel')}
                className="flex-1 px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-3 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors disabled:opacity-50"
              >
                <Search className="w-5 h-5" />
                {t('update.load')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Current Assignments */}
            {playerAssignments !== null && (() => {
              const dayOrder = researchDay === 'friday'
                ? ['monday', 'friday', 'thursday'] as const
                : ['monday', 'tuesday', 'thursday'] as const;
              const dayLabels: Record<string, string> = {
                monday: t('admin.monday'),
                tuesday: t('admin.tuesday'),
                friday: t('admin.friday'),
                thursday: t('admin.thursday'),
              };
              return (
                <div className="bg-success/10 border border-success/30 rounded-lg p-5">
                  <h3 className="text-lg font-semibold text-success mb-3">{t('update.currentAssignments')}</h3>
                  <div className="space-y-2">
                    {dayOrder.map((day) => {
                      const slots = playerAssignments[day] || [];
                      return (
                        <div key={day} className="flex items-center gap-3">
                          <span className="font-medium text-theme-text min-w-[200px]">{dayLabels[day] || day}:</span>
                          {slots.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {slots.map((s, i) => (
                                <span key={i} className="px-3 py-1 bg-success/20 text-success rounded-full text-sm font-medium">
                                  {formatTimeInTimezone(s.time_slot, timezone)}
                                  {s.time_slot === '23:50+' && <span className="text-xs opacity-60 ml-1">(+1d)</span>}
                                  {timezone !== 'UTC' && (
                                    <span className="opacity-60 ml-1 text-xs">({s.time_slot} UTC)</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-theme-dim text-sm italic">{t('update.noneAssigned')}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-theme-dim mt-3 italic">
                    {t('update.assignmentDisclaimer')}
                  </p>
                </div>
              );
            })()}

            {/* LootBar Affiliate */}
            <a
              href={LOOTBAR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-500/30 rounded-xl p-4 hover:border-amber-500/50 transition-all group"
            >
              <div className="flex items-center justify-center gap-3">
                <span className="text-xl">🔥</span>
                <p className="text-amber-400 font-medium text-sm">{t('promo.lootbarTitle')}</p>
                <ExternalLink className="w-3.5 h-3.5 text-amber-400 opacity-60 group-hover:opacity-100" />
              </div>
            </a>

            {/* Player Information */}
            <div>
              <h3 className="text-xl font-semibold mb-4 text-accent">{t('form.playerInfo')}</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-theme-text mb-2">
                      {t('form.gameName')}
                    </label>
                    <input
                      type="text"
                      name="game_name"
                      value={playerData.game_name}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-2">
                      {t('form.alliance')} *
                    </label>
                    <input
                      type="text"
                      name="alliance"
                      value={playerData.alliance || ''}
                      onChange={(e) => setPlayerData(prev => prev ? { ...prev, alliance: e.target.value.toUpperCase().slice(0, 3) } : prev)}
                      maxLength={3}
                      className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent uppercase"
                      placeholder={t('form.alliancePlaceholder')}
                      required
                    />
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-2">
                      {t('form.constructionSpeedups')}
                    </label>
                    <input
                      type="number"
                      name="construction_speedups_days"
                      value={playerData.construction_speedups_days}
                      onChange={handleInputChange}
                      min="0"
                      step="0.1"
                      className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-2">
                      {t('form.researchSpeedups')}
                    </label>
                    <input
                      type="number"
                      name="research_speedups_days"
                      value={playerData.research_speedups_days}
                      onChange={handleInputChange}
                      min="0"
                      step="0.1"
                      className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-theme-text mb-2">
                      {t('form.troopSpeedups')}
                    </label>
                    <input
                      type="number"
                      name="troop_training_speedups_days"
                      value={playerData.troop_training_speedups_days}
                      onChange={handleInputChange}
                      min="0"
                      step="0.1"
                      className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                    />
                  </div>
                  {showFireCrystals && (
                    <div>
                      <label className="block text-sm font-medium text-theme-text mb-2">
                        {t('form.fireCrystals')}
                      </label>
                      <input
                        type="number"
                        name="fire_crystals"
                        value={playerData.fire_crystals}
                        onChange={handleInputChange}
                        min="0"
                        className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                      />
                    </div>
                  )}
                  {showFireCrystals && (
                    <div>
                      <label className="block text-sm font-medium text-theme-text mb-2">
                        {t('form.refinedFireCrystals')}
                      </label>
                      <input
                        type="number"
                        name="refined_fire_crystals"
                        value={playerData.refined_fire_crystals}
                        onChange={handleInputChange}
                        min="0"
                        className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                      />
                    </div>
                  )}
                  {showFireCrystals && (
                    <div>
                      <label className="block text-sm font-medium text-theme-text mb-2">
                        {t('form.fireCrystalShards')}
                      </label>
                      <input
                        type="number"
                        name="fire_crystal_shards"
                        value={playerData.fire_crystal_shards}
                        onChange={handleInputChange}
                        min="0"
                        className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                      />
                    </div>
                  )}
                </div>
                {/* General Speedups Note */}
                <div className="mt-4 p-4 bg-accent/10 border border-accent/30 rounded-lg">
                  <p className="text-sm text-accent">
                    <strong>💡 </strong>{t('form.generalSpeedupsNote')}
                  </p>
                </div>
              </div>
            </div>

            {/* Time Preferences */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-accent">{t('form.selectTimes')}</h3>
                <TimezoneSelector value={timezone} onChange={setTimezone} />
              </div>

              <p className="text-sm text-accent text-center mb-4 font-medium">
                {t('form.selectAllAvailable')}
              </p>

              {/* Day type tabs */}
              <div className="flex gap-2 mb-4 border-b border-theme-border">
                {(['construction', 'research', 'troop'] as const).map((dayType) => {
                  const slots = playerData.time_slots_by_day?.[dayType] || [];
                  return (
                    <button
                      key={dayType}
                      onClick={() => setActiveTimeTab(dayType)}
                      className={`px-4 py-3 font-medium transition-colors border-b-2 ${
                        activeTimeTab === dayType
                          ? 'border-accent text-accent'
                          : 'border-transparent text-theme-dim hover:text-theme-text'
                      }`}
                    >
                      {dayTypeLabel(dayType)}
                      {slots.length > 0 && (
                        <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-accent/20 text-accent">
                          {slots.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {(() => {
                const dayHeatmap = heatmapData[activeTimeTab] || {};
                const counts = Object.values(dayHeatmap);
                const maxCount = counts.length > 0 ? Math.max(...counts) : 0;
                const getHeatColor = (utcVal: string) => {
                  const count = dayHeatmap[utcVal] || 0;
                  if (count === 0 || maxCount === 0) return undefined;
                  const ratio = count / maxCount;
                  if (ratio <= 0.33) return 'rgba(59, 130, 246, 0.25)';
                  if (ratio <= 0.66) return 'rgba(245, 158, 11, 0.3)';
                  return 'rgba(239, 68, 68, 0.3)';
                };
                const getHeatBorder = (utcVal: string) => {
                  const count = dayHeatmap[utcVal] || 0;
                  if (count === 0 || maxCount === 0) return undefined;
                  const ratio = count / maxCount;
                  if (ratio <= 0.33) return '2px solid rgba(59, 130, 246, 0.6)';
                  if (ratio <= 0.66) return '2px solid rgba(245, 158, 11, 0.7)';
                  return '2px solid rgba(239, 68, 68, 0.7)';
                };
                return (
                  <>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                      {timeSlotOptions.map(({ display, utcValue }) => {
                        const isSelected = (playerData.time_slots_by_day?.[activeTimeTab] || []).includes(utcValue);
                        const heatBg = getHeatColor(utcValue);
                        const heatBorder = getHeatBorder(utcValue);
                        const count = dayHeatmap[utcValue] || 0;
                        return (
                          <button
                            key={utcValue}
                            onClick={() => toggleTimeSlot(utcValue)}
                            className={`p-3 rounded-lg border-2 transition-all font-medium relative ${
                              isSelected
                                ? 'bg-accent border-accent text-dark-bg'
                                : 'bg-dark-input border-theme-border text-theme-text hover:border-accent'
                            }`}
                            style={!isSelected && heatBg ? { backgroundColor: heatBg, border: heatBorder } : undefined}
                            title={count > 0 ? `${count} applicant${count !== 1 ? 's' : ''}` : undefined}
                          >
                            {display}
                            {timezone !== 'UTC' && (
                              <span className={`block text-xs mt-0.5 ${isSelected ? 'opacity-70' : 'opacity-50'}`}>
                                {utcValue} UTC
                              </span>
                            )}
                            {isSelected && count > 0 && (
                              <span className="absolute top-0.5 right-1 text-[10px] font-bold opacity-70">
                                {count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {maxCount > 0 && (
                      <p className="text-xs text-theme-dim mt-2 text-center italic">
                        {t('form.heatmapLegend')}
                      </p>
                    )}
                  </>
                );
              })()}
              <p className="text-sm text-theme-dim mt-4 text-center">
                {t('form.selectedSlots', { count: (playerData.time_slots_by_day?.[activeTimeTab] || []).length })}
                {timezone !== 'UTC' && (
                  <span className="ml-2 text-accent">
                    ({t('form.timesShownIn')} {getTimezoneAbbr(timezone)})
                  </span>
                )}
              </p>
              <div className="mt-3 p-3 bg-accent/10 border border-accent/30 rounded-lg">
                <p className="text-sm text-accent text-center">
                  <strong>⏱ </strong>{t('form.timeToleranceNote')}
                </p>
              </div>
            </div>

            {/* Update Button */}
            <button
              onClick={handleUpdate}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {loading ? t('form.loading') : t('form.update')}
            </button>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-6 p-4 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-danger" />
            <p className="text-danger">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
