import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Calendar, AlertTriangle } from 'lucide-react';
import axios from 'axios';
import TimezoneSelector from '../components/TimezoneSelector';
import { getSavedTimezone, getSlotDisplayTime, generateAssignmentSlots, DEFAULT_SLOT_OFFSET } from '../lib/localization';

interface PublishedPlayer {
  game_name: string;
  alliance: string;
}

interface PublishedData {
  published: boolean;
  day?: string;
  day_label?: string;
  assignments?: { [slot: string]: PublishedPlayer[] };
}

export default function PublishedSchedule() {
  const navigate = useNavigate();
  const { day } = useParams<{ day: string }>();
  const { t } = useTranslation();
  const [data, setData] = useState<PublishedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState(getSavedTimezone);
  const [appsStillOpen, setAppsStillOpen] = useState(false);
  const [slotOffset, setSlotOffset] = useState<number>(DEFAULT_SLOT_OFFSET);

  useEffect(() => {
    if (!day) {
      setData({ published: false });
      setLoading(false);
      return;
    }
    axios.get(`/api/published-schedule/${day}`)
      .then(res => setData(res.data))
      .catch(() => setData({ published: false }))
      .finally(() => setLoading(false));

    axios.get('/api/settings/application-closing-time')
      .then(res => {
        // Show disclaimer if closing time is set but apps haven't closed yet
        if (res.data.closing_time && !res.data.is_closed) {
          setAppsStillOpen(true);
        }
      })
      .catch(() => {});

    axios.get('/api/settings/time-slot-offset')
      .then(res => {
        const value = res.data?.time_slot_offset;
        if (typeof value === 'number') setSlotOffset(value);
      })
      .catch(() => {});
  }, [day]);

  const allSlots = generateAssignmentSlots(slotOffset);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-theme-dim">{t('form.loading')}</p>
      </div>
    );
  }

  if (!data?.published) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-dark-card rounded-2xl p-12 border border-theme-border max-w-md w-full text-center">
          <Calendar className="w-16 h-16 text-theme-dim mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-theme-text mb-4">{t('schedule.noSchedule')}</h2>
          <p className="text-theme-dim mb-6">{t('schedule.noScheduleDesc')}</p>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 mx-auto text-accent hover:text-accent-dim"
          >
            <ArrowLeft className="w-5 h-5" />
            {t('update.backHome')}
          </button>
        </div>
      </div>
    );
  }

  const assignments = data.assignments || {};
  // Only show slots that have players assigned
  const populatedSlots = allSlots.filter(slot => (assignments[slot] || []).length > 0);

  // Translate the day label
  const dayKey = data.day || '';
  const translatedDayLabel = t(`admin.${dayKey}`, { defaultValue: data.day_label || dayKey });

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-dark-card rounded-2xl p-8 border border-theme-border max-w-5xl w-full">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-theme-dim hover:text-theme-text mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          {t('update.backHome')}
        </button>

        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold text-accent mb-2">
            {t('schedule.title')}
          </h2>
          <p className="text-xl text-theme-dim">{translatedDayLabel}</p>
        </div>

        {appsStillOpen && (
          <div className="mb-6 p-4 bg-warning/10 border border-warning/30 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0" />
            <p className="text-warning text-sm font-medium">{t('schedule.disclaimer')}</p>
          </div>
        )}

        <div className="flex justify-end mb-4">
          <TimezoneSelector value={timezone} onChange={setTimezone} />
        </div>

        {populatedSlots.length === 0 ? (
          <p className="text-center text-theme-dim py-8">{t('schedule.noAssignments')}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {populatedSlots.map(slot => {
              const players = assignments[slot] || [];
              const displayTime = getSlotDisplayTime(slot, timezone);
              return (
                <div
                  key={slot}
                  className="border border-theme-border rounded-lg p-3 bg-dark-bg"
                >
                  <div className="font-semibold text-accent mb-2 text-center">
                    {displayTime}
                    {slot.endsWith('+') && <span className="text-xs opacity-60 ml-1">(+1d)</span>}
                    {timezone !== 'UTC' && (
                      <span className="block text-xs text-theme-dim font-normal">
                        {slot.replace('+', '')} UTC
                      </span>
                    )}
                  </div>
                  {players.map((player, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-accent/10 border border-accent/30 rounded-lg text-center"
                    >
                      <div className="font-medium text-theme-text">
                        {player.alliance && (
                          <span className="text-accent">[{player.alliance}] </span>
                        )}
                        {player.game_name}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 text-center text-sm text-theme-dim">
          <p>{t('schedule.timesNote')}</p>
        </div>
      </div>
    </div>
  );
}
