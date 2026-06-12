import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, Edit, Clock, Palette, Globe, Lightbulb } from 'lucide-react';
import axios from 'axios';
import { getToleranceMinutes } from '../utils/slotOffset';

export default function PlayerGuide() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [timeSlotOffset, setTimeSlotOffset] = useState<number | null>(null);

  useEffect(() => {
    axios.get('/api/settings/time-slot-offset')
      .then(res => {
        const value = res.data?.time_slot_offset;
        if (typeof value === 'number') setTimeSlotOffset(value);
      })
      .catch(() => {});
  }, []);

  const toleranceMinutes = getToleranceMinutes(timeSlotOffset);

  return (
    <div className="min-h-screen bg-dark-bg py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-theme-dim hover:text-accent transition-colors mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          {t('update.backHome')}
        </button>

        <h1 className="text-4xl font-bold text-accent mb-2">{t('playerGuide.title')}</h1>
        <p className="text-theme-dim mb-8">{t('playerGuide.subtitle')}</p>

        <div className="space-y-8">
          {/* What is this system? */}
          <section className="bg-dark-card rounded-xl border border-theme-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
                <Lightbulb className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text">{t('playerGuide.whatIsTitle')}</h2>
            </div>
            <p className="text-theme-dim leading-relaxed">{t('playerGuide.whatIsBody')}</p>
          </section>

          {/* Step 1: Submitting */}
          <section className="bg-dark-card rounded-xl border border-theme-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
                <FileText className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text">{t('playerGuide.submitTitle')}</h2>
            </div>
            <div className="space-y-4 text-theme-dim leading-relaxed">
              <div>
                <h3 className="text-lg font-semibold text-theme-text mb-2">{t('playerGuide.step1Header')}</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>{t('playerGuide.step1Fid')}</li>
                  <li>{t('playerGuide.step1Wos')}</li>
                  <li>{t('playerGuide.step1Alliance')}</li>
                  <li>{t('playerGuide.step1Speedups')}</li>
                  <li>{t('playerGuide.step1General')}</li>
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-theme-text mb-2">{t('playerGuide.step2Header')}</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>{t('playerGuide.step2Select')}</li>
                  <li>{t('playerGuide.step2Days')}</li>
                  <li>{t('playerGuide.step2Timezone')}</li>
                  {toleranceMinutes !== null && (
                    <li>{t('playerGuide.step2Tolerance', { minutes: toleranceMinutes })}</li>
                  )}
                </ul>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-theme-text mb-2">{t('playerGuide.step3Header')}</h3>
                <p>{t('playerGuide.step3Body')}</p>
              </div>
            </div>
          </section>

          {/* Heat Map */}
          <section className="bg-dark-card rounded-xl border border-theme-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
                <Palette className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text">{t('playerGuide.heatmapTitle')}</h2>
            </div>
            <div className="text-theme-dim leading-relaxed space-y-3">
              <p>{t('playerGuide.heatmapBody')}</p>
              <div className="flex flex-wrap gap-3 mt-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-blue-500/40 border border-blue-400/60"></div>
                  <span className="text-sm">{t('playerGuide.heatmapBlue')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-yellow-500/40 border border-yellow-400/60"></div>
                  <span className="text-sm">{t('playerGuide.heatmapYellow')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-red-500/40 border border-red-400/60"></div>
                  <span className="text-sm">{t('playerGuide.heatmapRed')}</span>
                </div>
              </div>
              <p className="text-sm italic">{t('playerGuide.heatmapTip')}</p>
            </div>
          </section>

          {/* Viewing & Updating */}
          <section className="bg-dark-card rounded-xl border border-theme-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-success/20 rounded-full flex items-center justify-center">
                <Edit className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text">{t('playerGuide.updateTitle')}</h2>
            </div>
            <div className="text-theme-dim leading-relaxed space-y-3">
              <p>{t('playerGuide.updateBody1')}</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>{t('playerGuide.updateStep1')}</li>
                <li>{t('playerGuide.updateStep2')}</li>
                <li>{t('playerGuide.updateStep3')}</li>
                <li>{t('playerGuide.updateStep4')}</li>
              </ul>
              <p className="text-sm italic">{t('playerGuide.updateNote')}</p>
            </div>
          </section>

          {/* Understanding Assignments */}
          <section className="bg-dark-card rounded-xl border border-theme-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text">{t('playerGuide.assignmentsTitle')}</h2>
            </div>
            <div className="text-theme-dim leading-relaxed space-y-3">
              <p>{t('playerGuide.assignmentsBody')}</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>{t('playerGuide.assignmentsPoint1')}</li>
                <li>{t('playerGuide.assignmentsPoint2')}</li>
                <li>{t('playerGuide.assignmentsPoint3')}</li>
                <li>{t('playerGuide.assignmentsPoint4')}</li>
              </ul>
            </div>
          </section>

          {/* Timezone */}
          <section className="bg-dark-card rounded-xl border border-theme-border p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center">
                <Globe className="w-5 h-5 text-accent" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text">{t('playerGuide.timezoneTitle')}</h2>
            </div>
            <div className="text-theme-dim leading-relaxed space-y-3">
              <p>{t('playerGuide.timezoneBody')}</p>
            </div>
          </section>

          {/* Tips */}
          <section className="bg-accent/10 border border-accent/30 rounded-xl p-6">
            <h2 className="text-2xl font-bold text-accent mb-4">{t('playerGuide.tipsTitle')}</h2>
            <ul className="space-y-2 text-theme-dim">
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">✦</span>
                <span>{t('playerGuide.tip1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">✦</span>
                <span>{t('playerGuide.tip2')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">✦</span>
                <span>{t('playerGuide.tip3')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">✦</span>
                <span>{t('playerGuide.tip4')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-1">✦</span>
                <span>{t('playerGuide.tip5')}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
