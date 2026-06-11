import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, CheckCircle, AlertCircle, Download, Loader2, XCircle } from 'lucide-react';
import axios from 'axios';
import TimezoneSelector from '../components/TimezoneSelector';
import { getSavedTimezone, generatePlayerTimeSlots, formatTimeInTimezone, getTimezoneAbbr } from '../utils/timezone';

interface PlayerData {
  fid: string;
  game_name: string;
  construction_speedups_days: number;
  research_speedups_days: number;
  troop_training_speedups_days: number;
  general_speedups_days: number;
  fire_crystals: number;
  refined_fire_crystals: number;
  fire_crystal_shards: number;
  avatar_image?: string;
  stove_lv?: number;
  stove_lv_content?: string;
  alliance?: string;
}

export default function PlayerForm() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [wosLoading, setWosLoading] = useState(false);
  const [showFireCrystals, setShowFireCrystals] = useState(false);
  const [researchDay, setResearchDay] = useState('tuesday');
  const [timezone, setTimezone] = useState(getSavedTimezone);
  const [heatmapData, setHeatmapData] = useState<Record<string, Record<string, number>>>({});
  const [appsClosed, setAppsClosed] = useState(false);
  const [closingChecked, setClosingChecked] = useState(false);

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
    axios.get('/api/settings/application-closing-time')
      .then(res => {
        setAppsClosed(res.data.is_closed || false);
        setClosingChecked(true);
      })
      .catch(() => setClosingChecked(true));
  }, []);

  const [playerData, setPlayerData] = useState<PlayerData>({
    fid: '',
    game_name: '',
    alliance: '',
    construction_speedups_days: 0,
    research_speedups_days: 0,
    troop_training_speedups_days: 0,
    general_speedups_days: 0,
    fire_crystals: 0,
    refined_fire_crystals: 0,
    fire_crystal_shards: 0,
  });

  const [selectedTimesByDay, setSelectedTimesByDay] = useState<{
    construction: string[];
    research: string[];
    troop: string[];
  }>({ construction: [], research: [], troop: [] });

  // Generate time slots: display in chosen timezone, store as UTC
  const timeSlotOptions = generatePlayerTimeSlots(timezone);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setPlayerData(prev => ({
      ...prev,
      [name]: name === 'game_name' || name === 'fid' || name === 'alliance' ? value : parseFloat(value) || 0,
    }));
  };

  const handleWosLookup = async () => {
    if (!playerData.fid.trim()) {
      setError(t('form.enterFidFirst'));
      return;
    }

    setWosLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/player/wos-lookup', {
        fid: playerData.fid.trim(),
      });

      const wosData = response.data;
      setPlayerData(prev => ({
        ...prev,
        game_name: wosData.nickname || prev.game_name,
        avatar_image: wosData.avatar_image || undefined,
        stove_lv: wosData.stove_lv || undefined,
        stove_lv_content: wosData.stove_lv_content || undefined,
      }));
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('form.wosLookupFailed');
      setError(msg);
    } finally {
      setWosLoading(false);
    }
  };

  // Map step number to day type
  const stepDayType = { 2: 'construction', 3: 'research', 4: 'troop' } as const;
  const researchDayName = t(`form.${researchDay === 'friday' ? 'fridayName' : 'tuesdayName'}`);
  const dayTypeLabel = (dayType: string) =>
    t(`form.${dayType}Times`, dayType === 'research' ? { day: researchDayName } : {});

  const toggleTimeSlot = (utcValue: string) => {
    const dayType = stepDayType[step as 2 | 3 | 4];
    if (!dayType) return;
    setSelectedTimesByDay(prev => ({
      ...prev,
      [dayType]: prev[dayType].includes(utcValue)
        ? prev[dayType].filter(t => t !== utcValue)
        : [...prev[dayType], utcValue],
    }));
  };

  const [duplicateWarning, setDuplicateWarning] = useState('');

  const validateStep1 = async () => {
    if (!playerData.game_name.trim()) {
      setError(t('form.required'));
      return false;
    }
    // FID is now required
    if (!playerData.fid || !playerData.fid.trim()) {
      setError(t('form.fidRequired'));
      return false;
    }
    // Alliance is required
    if (!playerData.alliance || !playerData.alliance.trim()) {
      setError(t('form.allianceRequired'));
      return false;
    }

    // Check for duplicate FID or game name
    try {
      const res = await axios.post('/api/player/check-duplicate', {
        fid: playerData.fid.trim(),
        game_name: playerData.game_name.trim(),
      });
      if (res.data.fid_exists || res.data.name_exists) {
        setDuplicateWarning(t('form.playerAlreadyExists'));
        setError('');
        return false;
      }
    } catch {
      // If check fails, allow submission to proceed
    }

    setError('');
    setDuplicateWarning('');
    return true;
  };

  const handleNext = async () => {
    if (step === 1 && !(await validateStep1())) {
      return;
    }
    // Warn if no time slots selected on time preference steps
    if (step >= 2 && step <= 4) {
      const dayType = stepDayType[step as 2 | 3 | 4];
      if (selectedTimesByDay[dayType].length === 0) {
        if (!window.confirm(t('form.noTimeSlotsConfirm'))) {
          return;
        }
      }
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
    setError('');
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const submitData = {
        ...playerData,
        time_slots_by_day: selectedTimesByDay,
        timezone,
      };

      await axios.post('/api/player/submit', submitData);
      setSuccess(true);
      setTimeout(() => {
        navigate('/');
      }, 5000);
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('form.submitError');
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
          <p className="text-theme-dim mb-6">{t('form.submissionSuccess')}</p>
        </div>
      </div>
    );
  }

  if (closingChecked && appsClosed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-dark-card rounded-2xl p-12 border border-theme-border max-w-md w-full text-center">
          <XCircle className="w-20 h-20 text-danger mx-auto mb-6" />
          <h2 className="text-3xl font-bold text-danger mb-4">{t('home.applicationsClosed')}</h2>
          <p className="text-theme-dim mb-6">{t('form.applicationsClosedDesc')}</p>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 mx-auto text-accent hover:text-accent-dim transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            {t('update.backHome')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-dark-card rounded-2xl p-8 border border-theme-border max-w-4xl w-full">
        {/* Progress Indicator */}
        <div className="flex items-center justify-center mb-8">
          {[1, 2, 3, 4, 5].map((num) => (
            <div key={num} className="flex items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  step >= num
                    ? 'bg-accent text-dark-bg'
                    : 'bg-dark-bg text-theme-dim border-2 border-theme-border'
                }`}
              >
                {num}
              </div>
              {num < 5 && (
                <div
                  className={`w-8 h-1 mx-1 ${
                    step > num ? 'bg-accent' : 'bg-theme-border'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Player Information */}
        {step === 1 && (
          <div>
            <h2 className="text-3xl font-bold text-accent mb-6 text-center">
              {t('form.step1Title')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-theme-text mb-2">
                  {t('form.playerID')} *
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    name="fid"
                    value={playerData.fid}
                    onChange={handleInputChange}
                    className="flex-1 px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                    placeholder={t('form.playerIDPlaceholder')}
                    required
                  />
                  <button
                    type="button"
                    onClick={handleWosLookup}
                    disabled={wosLoading || !playerData.fid.trim()}
                    className="flex items-center gap-2 px-4 py-3 bg-success text-dark-bg rounded-lg hover:bg-success/80 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {wosLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Download className="w-5 h-5" />
                    )}
                    {t('form.loadFromWOS')}
                  </button>
                </div>
              </div>

              {/* Avatar preview after WOS lookup */}
              {playerData.avatar_image && (
                <div className="flex items-center gap-4 p-4 bg-dark-bg rounded-lg border border-accent/30">
                  <img
                    src={playerData.avatar_image}
                    alt="Player avatar"
                    className="w-16 h-16 rounded-full border-2 border-accent"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  {playerData.stove_lv_content && (
                    <img
                      src={playerData.stove_lv_content}
                      alt={`Furnace level ${playerData.stove_lv}`}
                      className="w-8 h-8"
                    />
                  )}
                  <div className="text-theme-text font-medium">
                    {playerData.alliance && <span className="text-accent">[{playerData.alliance}] </span>}
                    {playerData.game_name}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-theme-text mb-2">
                    {t('form.gameName')} *
                  </label>
                  <input
                    type="text"
                    name="game_name"
                    value={playerData.game_name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent"
                    required
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
                    onChange={(e) => setPlayerData(prev => ({ ...prev, alliance: e.target.value.toUpperCase().slice(0, 3) }))}
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
        )}

        {/* Steps 2-4: Time Preferences per day type */}
        {(step === 2 || step === 3 || step === 4) && (() => {
          const dayType = stepDayType[step as 2 | 3 | 4];
          const slots = selectedTimesByDay[dayType];
          return (
            <div>
              <h2 className="text-3xl font-bold text-accent mb-4 text-center">
                {dayTypeLabel(dayType)}
              </h2>
              <div className="flex items-center justify-center gap-4 mb-4">
                <p className="text-theme-dim">{t('form.selectMultiple')}</p>
                <TimezoneSelector value={timezone} onChange={setTimezone} />
              </div>
              <p className="text-sm text-accent text-center mb-6 font-medium">
                {t('form.selectAllAvailable')}
              </p>
              {(() => {
                const dayHeatmap = heatmapData[dayType] || {};
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
                        const isSelected = slots.includes(utcValue);
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
                {t('form.selectedSlots', { count: slots.length })}
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
          );
        })()}

        {/* Step 5: Review */}
        {step === 5 && (
          <div>
            <h2 className="text-3xl font-bold text-accent mb-6 text-center">
              {t('form.step3Title')}
            </h2>
            <div className="space-y-4">
              <div className="bg-dark-bg p-6 rounded-lg border border-theme-border">
                {playerData.avatar_image && (
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-theme-border">
                    <img src={playerData.avatar_image} alt="Avatar" className="w-12 h-12 rounded-full border-2 border-accent" />
                    {playerData.stove_lv_content && (
                      <img src={playerData.stove_lv_content} alt="Stove level" className="w-6 h-6" />
                    )}
                  </div>
                )}
                <h3 className="font-semibold text-lg mb-4 text-accent">{t('form.playerInfo')}</h3>
                <div className="grid md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-theme-dim">{t('form.gameName')}:</span>
                    <span className="ml-2 font-medium text-theme-text">
                      {playerData.alliance && <span className="text-accent">[{playerData.alliance}] </span>}
                      {playerData.game_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-theme-dim">{t('form.playerID')}:</span>
                    <span className="ml-2 font-medium text-theme-text">{playerData.fid}</span>
                  </div>
                  <div>
                    <span className="text-theme-dim">{t('form.constructionSpeedups')}:</span>
                    <span className="ml-2 font-medium text-theme-text">{playerData.construction_speedups_days} {t('form.days')}</span>
                  </div>
                  <div>
                    <span className="text-theme-dim">{t('form.researchSpeedups')}:</span>
                    <span className="ml-2 font-medium text-theme-text">{playerData.research_speedups_days} {t('form.days')}</span>
                  </div>
                  <div>
                    <span className="text-theme-dim">{t('form.troopSpeedups')}:</span>
                    <span className="ml-2 font-medium text-theme-text">{playerData.troop_training_speedups_days} {t('form.days')}</span>
                  </div>
                  {showFireCrystals && (
                    <div>
                      <span className="text-theme-dim">{t('form.fireCrystals')}:</span>
                      <span className="ml-2 font-medium text-theme-text">{playerData.fire_crystals}</span>
                    </div>
                  )}
                  {showFireCrystals && (
                    <div>
                      <span className="text-theme-dim">{t('form.refinedFireCrystals')}:</span>
                      <span className="ml-2 font-medium text-theme-text">{playerData.refined_fire_crystals}</span>
                    </div>
                  )}
                  {showFireCrystals && (
                    <div>
                      <span className="text-theme-dim">{t('form.fireCrystalShards')}:</span>
                      <span className="ml-2 font-medium text-theme-text">{playerData.fire_crystal_shards}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-dark-bg p-6 rounded-lg border border-theme-border">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-lg text-accent">{t('form.timePreferences')}</h3>
                  <TimezoneSelector value={timezone} onChange={setTimezone} />
                </div>
                {(['construction', 'research', 'troop'] as const).map((dayType) => (
                  <div key={dayType} className="mb-3 last:mb-0">
                    <p className="text-sm font-medium text-theme-dim mb-1">{dayTypeLabel(dayType)}</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedTimesByDay[dayType].sort().map((time) => (
                        <span
                          key={time}
                          className="px-3 py-1 bg-accent/20 text-accent rounded-full text-sm font-medium"
                        >
                          {formatTimeInTimezone(time, timezone)}
                          {timezone !== 'UTC' && (
                            <span className="opacity-60 ml-1 text-xs">({time} UTC)</span>
                          )}
                        </span>
                      ))}
                      {selectedTimesByDay[dayType].length === 0 && (
                        <span className="text-theme-dim text-sm">{t('form.noTimeSelected')}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Duplicate Warning */}
        {duplicateWarning && (
          <div className="mt-6 p-4 bg-warning/10 border border-warning/30 rounded-lg">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-warning flex-shrink-0" />
              <p className="text-warning">{duplicateWarning}</p>
            </div>
            <button
              onClick={() => navigate('/update')}
              className="mt-3 px-4 py-2 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors text-sm"
            >
              {t('update.title')}
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

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-8">
          <button
            onClick={step === 1 ? () => navigate('/') : handleBack}
            className="flex items-center gap-2 px-6 py-3 border-2 border-theme-border rounded-lg hover:bg-dark-card-hover font-medium transition-colors text-theme-text"
          >
            <ArrowLeft className="w-5 h-5" />
            {t('form.back')}
          </button>
          {step < 5 ? (
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-6 py-3 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors"
            >
              {t('form.next')}
              <ArrowRight className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('form.loading') : t('form.submit')}
              <CheckCircle className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
