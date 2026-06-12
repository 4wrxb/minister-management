import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, X, Check, ToggleLeft, ToggleRight } from 'lucide-react';
import axios from 'axios';
import { VALID_SLOT_OFFSETS, DEFAULT_SLOT_OFFSET, type SlotOffset } from '../../utils/timezone';

export default function AdminSettings() {
  const { t } = useTranslation();
  const [stateNumber, setStateNumber] = useState('');
  const [closingTimeLocal, setClosingTimeLocal] = useState('');
  const [currentClosingTime, setCurrentClosingTime] = useState('');
  const [isClosed, setIsClosed] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [researchDay, setResearchDay] = useState<'tuesday' | 'friday'>('tuesday');
  const [showFireCrystals, setShowFireCrystals] = useState(false);
  const [slotOffset, setSlotOffset] = useState<SlotOffset>(DEFAULT_SLOT_OFFSET);
  const [slotOffsetError, setSlotOffsetError] = useState('');

  const token = localStorage.getItem('adminToken') || '';

  useEffect(() => {
    // Fetch current settings
    axios.get('/api/settings/state-number')
      .then(res => setStateNumber(res.data.state_number || ''))
      .catch(() => {});

    axios.get('/api/settings/research-day')
      .then(res => setResearchDay(res.data.research_day || 'tuesday'))
      .catch(() => {});

    axios.get('/api/settings/show-fire-crystals')
      .then(res => setShowFireCrystals(res.data.show_fire_crystals || false))
      .catch(() => {});

    axios.get('/api/settings/time-slot-offset')
      .then(res => {
        const value = res.data?.time_slot_offset;
        if (typeof value === 'number' && (VALID_SLOT_OFFSETS as readonly number[]).includes(value)) {
          setSlotOffset(value as SlotOffset);
        }
      })
      .catch(() => {});

    axios.get('/api/settings/application-closing-time')
      .then(res => {
        setCurrentClosingTime(res.data.closing_time || '');
        setIsClosed(res.data.is_closed || false);
        if (res.data.closing_time) {
          // Convert UTC ISO to local datetime-local format
          const dt = new Date(res.data.closing_time);
          const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
          setClosingTimeLocal(local.toISOString().slice(0, 16));
        }
      })
      .catch(() => {});
  }, []);

  const showSaveMessage = () => {
    setSaveMessage(t('admin.settingsSaved'));
    setTimeout(() => setSaveMessage(''), 3000);
  };

  const handleSaveStateNumber = async () => {
    try {
      await axios.put('/api/admin/settings/state-number',
        { state_number: stateNumber },
        { headers: { Authorization: token } }
      );
      showSaveMessage();
    } catch {
      // ignore
    }
  };

  const handleSaveClosingTime = async () => {
    try {
      // Convert local datetime to UTC ISO string
      let utcString = '';
      if (closingTimeLocal) {
        const localDate = new Date(closingTimeLocal);
        utcString = localDate.toISOString();
      }
      const res = await axios.put('/api/admin/settings/application-closing-time',
        { closing_time: utcString },
        { headers: { Authorization: token } }
      );
      setCurrentClosingTime(res.data.closing_time || '');
      setIsClosed(false);
      showSaveMessage();
    } catch {
      // ignore
    }
  };

  const handleClearClosingTime = async () => {
    try {
      await axios.put('/api/admin/settings/application-closing-time',
        { closing_time: '' },
        { headers: { Authorization: token } }
      );
      setCurrentClosingTime('');
      setClosingTimeLocal('');
      setIsClosed(false);
      showSaveMessage();
    } catch {
      // ignore
    }
  };

  const handleToggleResearchDay = async () => {
    const newDay = researchDay === 'tuesday' ? 'friday' : 'tuesday';
    try {
      await axios.put('/api/admin/settings/research-day',
        { research_day: newDay },
        { headers: { Authorization: token } }
      );
      setResearchDay(newDay);
      showSaveMessage();
    } catch {
      // ignore
    }
  };

  const handleToggleFireCrystals = async () => {
    const newValue = !showFireCrystals;
    try {
      await axios.put('/api/admin/settings/show-fire-crystals',
        { show_fire_crystals: newValue },
        { headers: { Authorization: token } }
      );
      setShowFireCrystals(newValue);
      showSaveMessage();
    } catch {
      // ignore
    }
  };

  const handleChangeSlotOffset = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = parseInt(e.target.value, 10) as SlotOffset;
    const previous = slotOffset;
    setSlotOffset(newValue);
    setSlotOffsetError('');
    try {
      await axios.put('/api/admin/settings/time-slot-offset',
        { time_slot_offset: newValue },
        { headers: { Authorization: token } }
      );
      setSaveMessage(t('admin.slotOffsetUpdated'));
      setTimeout(() => setSaveMessage(''), 3000);
    } catch {
      setSlotOffset(previous);
      setSlotOffsetError(t('admin.slotOffsetError'));
    }
  };

  return (
    <div className="space-y-6">
      {/* Save confirmation */}
      {saveMessage && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-3 flex items-center gap-2">
          <Check className="w-5 h-5 text-success" />
          <span className="text-success font-medium">{saveMessage}</span>
        </div>
      )}

      {/* State Number */}
      <div className="bg-dark-card rounded-xl border border-theme-border p-6">
        <h3 className="text-xl font-bold text-accent mb-2">{t('admin.stateNumber')}</h3>
        <p className="text-theme-dim text-sm mb-4">{t('admin.stateNumberDesc')}</p>
        <div className="flex gap-3 items-center">
          <input
            type="text"
            value={stateNumber}
            onChange={(e) => setStateNumber(e.target.value)}
            placeholder={t('admin.stateNumberPlaceholder')}
            className="px-4 py-2 bg-dark-input border border-theme-border rounded-lg text-theme-text placeholder-theme-dim focus:ring-2 focus:ring-accent focus:border-accent w-48"
          />
          <button
            onClick={handleSaveStateNumber}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {t('common.save')}
          </button>
        </div>
      </div>

      {/* Application Closing Time */}
      <div className="bg-dark-card rounded-xl border border-theme-border p-6">
        <h3 className="text-xl font-bold text-accent mb-2">{t('admin.closingTime')}</h3>
        <p className="text-theme-dim text-sm mb-4">{t('admin.closingTimeDesc')}</p>
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="datetime-local"
            value={closingTimeLocal}
            onChange={(e) => setClosingTimeLocal(e.target.value)}
            className="px-4 py-2 bg-dark-input border border-theme-border rounded-lg text-theme-text focus:ring-2 focus:ring-accent focus:border-accent"
          />
          <button
            onClick={handleSaveClosingTime}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {t('common.save')}
          </button>
          <button
            onClick={handleClearClosingTime}
            className="flex items-center gap-2 px-4 py-2 bg-danger/20 text-danger rounded-lg hover:bg-danger/30 font-medium transition-colors"
          >
            <X className="w-4 h-4" />
            {t('admin.clear')}
          </button>
        </div>
        <div className="mt-3 text-sm">
          {currentClosingTime ? (
            <p className={isClosed ? 'text-danger' : 'text-success'}>
              {t('admin.currentClosingTime')}: {new Date(currentClosingTime).toLocaleString()}
              {isClosed && <span className="ml-2 font-medium">({t('home.applicationsClosed')})</span>}
            </p>
          ) : (
            <p className="text-theme-dim italic">{t('admin.noClosingTime')}</p>
          )}
        </div>
      </div>
      {/* Research Day Toggle */}
      <div className="bg-dark-card rounded-xl border border-theme-border p-6">
        <h3 className="text-xl font-bold text-accent mb-2">{t('admin.researchDayToggle')}</h3>
        <p className="text-theme-dim text-sm mb-4">{t('admin.researchDayDesc')}</p>
        <button
          onClick={handleToggleResearchDay}
          className="flex items-center gap-2 px-4 py-3 bg-dark-bg border border-theme-border rounded-lg hover:border-accent transition-colors"
        >
          {researchDay === 'tuesday' ? (
            <>
              <ToggleLeft className="w-7 h-7 text-accent" />
              <span className="text-accent font-medium text-lg">{t('admin.tuesday').split(' - ')[0]}</span>
            </>
          ) : (
            <>
              <ToggleRight className="w-7 h-7 text-accent" />
              <span className="text-accent font-medium text-lg">{t('admin.friday').split(' - ')[0]}</span>
            </>
          )}
        </button>
      </div>

      {/* Show Fire Crystal Fields */}
      <div className="bg-dark-card rounded-xl border border-theme-border p-6">
        <h3 className="text-xl font-bold text-accent mb-2">{t('admin.showFireCrystals')}</h3>
        <p className="text-theme-dim text-sm mb-4">{t('admin.showFireCrystalsDesc')}</p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showFireCrystals}
            onChange={handleToggleFireCrystals}
            className="w-5 h-5 accent-accent"
          />
          <span className={`font-medium ${showFireCrystals ? 'text-accent' : 'text-theme-dim'}`}>
            {showFireCrystals ? t('admin.enabled') : t('admin.disabled')}
          </span>
        </label>
      </div>

      {/* Time Slot Offset */}
      <div className="bg-dark-card rounded-xl border border-theme-border p-6">
        <h3 className="text-xl font-bold text-accent mb-2">{t('admin.slotOffset')}</h3>
        <p className="text-theme-dim text-sm mb-4">{t('admin.slotOffsetDesc')}</p>
        <div className="flex items-center gap-3">
          <select
            value={slotOffset}
            onChange={handleChangeSlotOffset}
            aria-label={t('admin.slotOffset')}
            className="px-4 py-2 bg-dark-input border border-theme-border rounded-lg text-theme-text focus:ring-2 focus:ring-accent focus:border-accent"
          >
            {VALID_SLOT_OFFSETS.map(value => (
              <option key={value} value={value}>
                {value} {t('admin.minutes')}
              </option>
            ))}
          </select>
        </div>
        {slotOffsetError && (
          <p className="mt-2 text-sm text-danger">{slotOffsetError}</p>
        )}
      </div>
    </div>
  );
}
