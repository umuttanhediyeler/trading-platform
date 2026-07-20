import {
  Bot,
  CandlestickChart,
  FlaskConical,
  Landmark,
  Layers,
  ListChecks,
  Radar,
  Rocket,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface HelpSection {
  id: string;
  title: string;
  icon: LucideIcon;
  summary: string;
  body: React.ReactNode;
}

/** Content adapted from sistem_e_kitabi.docx ("Sistem Nasıl Çalışır, Nasıl Kullanılır?"). */
export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "giris",
    title: "Giriş",
    icon: Rocket,
    summary: "Platform ne yapar, neyi vaat etmez.",
    body: (
      <>
        <p>
          Bu platform; gerçek zamanlı piyasa taraması, kural tabanlı ve makine öğrenmesi destekli
          sinyal üretimi, risksiz simülasyon ortamı ve isteğe bağlı otomatik işlem yürütmesini bir
          araya getirir.
        </p>
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-warning">
          Önemli: Bu sistem finansal tavsiye vermez. Üretilen sinyaller geçmiş veriye dayalı
          istatistiksel olasılıklardır; gelecekteki sonuçları garanti etmez. Her zaman kendi risk
          toleransınıza göre karar verin.
        </p>
      </>
    ),
  },
  {
    id: "mimari",
    title: "Sistem Mimarisi",
    icon: Layers,
    summary: "Birbirinden bağımsız çalışan altı katman.",
    body: (
      <ul className="list-disc space-y-1.5 pl-4">
        <li><strong>Veri katmanı</strong> — piyasa fiyat ve hacim verisini toplar, normalize eder.</li>
        <li><strong>Tarama motoru</strong> — kriterlere göre binlerce hisseyi saniyeler içinde filtreler.</li>
        <li><strong>AI sinyal motoru</strong> — eğitilmiş modellerin ürettiği giriş/çıkış önerileri.</li>
        <li><strong>Backtest motoru</strong> — stratejilerin geçmiş performansını simüle eder.</li>
        <li><strong>Simülasyon hesabı</strong> — sanal bakiyeyle risksiz uygulama ortamı.</li>
        <li><strong>Broker entegrasyonu</strong> — isteğe bağlı gerçek hesap bağlantısı ve emir gönderimi.</li>
      </ul>
    ),
  },
  {
    id: "planlar",
    title: "Abonelik Planları",
    icon: Wallet,
    summary: "Free, Basic ve Premium seviyelerinin farkları.",
    body: (
      <>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Özellik</th>
                <th className="px-3 py-2">Free</th>
                <th className="px-3 py-2">Basic</th>
                <th className="px-3 py-2">Premium</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Veri gecikmesi", "15 dk", "Gerçek zamanlı", "Gerçek zamanlı"],
                ["Tarama filtresi", "5 adet", "Sınırsız", "Sınırsız"],
                ["AI sinyal motoru", "—", "—", "Var"],
                ["Backtest", "—", "Sınırlı", "Sınırsız"],
                ["Simülasyon hesabı", "Var", "Var", "Var"],
                ["Tek tık işlem", "—", "Var", "Var"],
                ["Tam otomatik işlem", "—", "—", "Var (onaylı risk limitiyle)"],
              ].map(([feature, free, basic, premium]) => (
                <tr key={feature} className="border-t border-border">
                  <td className="px-3 py-2">{feature}</td>
                  <td className="px-3 py-2 font-mono">{free}</td>
                  <td className="px-3 py-2 font-mono">{basic}</td>
                  <td className="px-3 py-2 font-mono">{premium}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3">
          Free plan platformu tanımak isteyenler içindir. Basic, aktif manuel işlem yapanlara gerçek
          zamanlı veri ve sınırsız tarama sunar. Premium; AI sinyal motoru ve otomatik işlem
          yürütmesini içeren en kapsamlı pakettir.
        </p>
      </>
    ),
  },
  {
    id: "tarama",
    title: "Tarama Motoru",
    icon: Radar,
    summary: "Binlerce hisseyi saniyeler içinde filtreleyin.",
    body: (
      <p>
        Tarama motoru; hacim artışı, fiyat aralığı ve teknik gösterge eşikleri (RSI, hareketli
        ortalama kesişimi) gibi kriterlere uyan hisseleri saniyeler içinde bulur. Hazır şablonlardan
        birini seçebilir (örn. &quot;gün içi hacim patlaması&quot;, &quot;aşırı satım dönüşü&quot;)
        veya kendi kriter kombinasyonunuzu oluşturabilirsiniz. Sonuçlar canlı güncellenir; kriterlere
        uyan yeni bir hisse anında tabloya eklenir.
      </p>
    ),
  },
  {
    id: "ai-sinyal",
    title: "Modeller & AI Sinyaller",
    icon: Bot,
    summary: "Modeller sayfası ne işe yarar, sinyaller nasıl üretilir.",
    body: (
      <>
        <p>
          <strong>Modeller</strong> sekmesi, AI sinyallerini üreten makine öğrenmesi modellerinin
          durumunu gösterir: hangi sürüm canlı (champion), hangisi gölge testte (shadow), son hit
          oranı ve ortalama getiri. Bu ekran alım-satım yapmaz; model sağlığını izlemenizi sağlar.
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-4">
          <li>
            Sistem geçmiş bar verisiyle modelleri eğitir; en iyi aday gölge değerlendirmeden geçmeden
            canlıya alınmaz.
          </li>
          <li>
            Canlı model her sinyal döngüsünde giriş, stop ve hedef fiyat önerisi üretir; bunlar
            Signals sekmesinde görünür.
          </li>
          <li>
            Performans düşerse sistem modeli geri alabilir (rollback); yeni model ancak soak süresi
            ve canlı örnek eşiğini geçince yükseltilir.
          </li>
        </ul>
        <p className="mt-3">
          Geçmiş performans gelecekteki sonuçların garantisi değildir; modeller periyodik olarak
          yeniden eğitilir ve izlenir.
        </p>
      </>
    ),
  },
  {
    id: "backtest",
    title: "Backtest ve Performans Ölçümü",
    icon: CandlestickChart,
    summary: "Stratejinizi geçmiş veride sınayın.",
    body: (
      <p>
        Backtest motoru bir stratejinin geçmiş verideki performansını simüle eder; toplam getiri,
        kazanma oranı, ortalama kâr/zarar oranı ve maksimum düşüş (drawdown) raporlanır. Backtest
        sonucu ile gerçek/simüle performans arasında belirgin sapma tespit edilirse sistem sizi
        otomatik uyarır — bu, stratejinin &quot;bayatlamış&quot; olabileceğinin işaretidir.
      </p>
    ),
  },
  {
    id: "simulasyon",
    title: "Simülasyon Hesabı",
    icon: FlaskConical,
    summary: "Gerçek para riske atmadan pratik yapın.",
    body: (
      <p>
        Her kullanıcı, sanal bakiyeyle gerçek piyasa verisi üzerinde işlem açıp kapatabileceği bir
        simülasyon hesabına sahiptir. AI sinyallerinin otomatik simülasyonunu izleyebilir veya kendi
        kararlarınızla manuel işlem açabilirsiniz. Gerçek hesap bağlamadan önce en az birkaç hafta
        simülasyonda pratik yapmanız önerilir.
      </p>
    ),
  },
  {
    id: "risk",
    title: "İşlem Modları ve Risk Yönetimi",
    icon: ShieldCheck,
    summary: "Manuel, tek tık ve tam otomatik modlar.",
    body: (
      <>
        <ul className="list-disc space-y-1.5 pl-4">
          <li>
            <strong>Manuel mod</strong> — sistem yalnızca sinyali gösterir; işlemi siz açarsınız.
          </li>
          <li>
            <strong>Tek tık modu</strong> — broker bağlıysa sinyali önceden belirlenmiş risk
            parametreleriyle tek tıkla işleme dönüştürürsünüz; her işlem onayınızı gerektirir.
          </li>
          <li>
            <strong>Tam otomatik mod</strong> — onayladığınız risk kurallarına göre emirler otomatik
            gönderilir.
          </li>
        </ul>
        <p className="mt-3">Tam otomatik mod için zorunlu güvenlik mekanizmaları:</p>
        <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
          <li>Günlük maksimum işlem sayısı sınırı</li>
          <li>Günlük maksimum zarar sınırı (aşılırsa otomatik olarak manuel moda geçilir)</li>
          <li>İşlem başına maksimum risk yüzdesi</li>
          <li>Her ekrandan erişilebilen &quot;acil durdur&quot; (kill switch) butonu</li>
        </ul>
      </>
    ),
  },
  {
    id: "broker",
    title: "Broker Bağlantısı ve Canlı İşlem",
    icon: Landmark,
    summary: "Gerçek hesaba geçiş ve paper trading.",
    body: (
      <p>
        Desteklenen bir broker hesabını (örn. Alpaca) Ayarlar &gt; Broker bölümünden
        bağlayabilirsiniz. Bağlantı brokerin güvenli kimlik doğrulama akışıyla yapılır; platform
        kullanıcı adı/parolanızı saklamaz. Canlı hesaba geçmeden önce sistemin paper trading
        modunda test edilmesi şiddetle önerilir.
      </p>
    ),
  },
  {
    id: "kilavuz",
    title: "Adım Adım Kullanım",
    icon: ListChecks,
    summary: "Kayıttan broker bağlamaya altı adım.",
    body: (
      <ol className="list-decimal space-y-2 pl-4">
        <li>
          <strong>Hesap oluşturun</strong> — e-posta ile kayıt olun; varsayılan olarak Free plana
          atanırsınız.
        </li>
        <li>
          <strong>İlk taramanızı yapın</strong> — Dashboard&apos;da hazır bir şablon seçin; bir
          satıra tıklayınca ilgili hissenin grafiği açılır.
        </li>
        <li>
          <strong>Watchlist oluşturun</strong> — ilginizi çeken hisseleri takip listenize ekleyin.
        </li>
        <li>
          <strong>Simülasyonda pratik yapın</strong> — Simulation sekmesinden sanal bakiyeyle işlem
          açın.
        </li>
        <li>
          <strong>Premium&apos;a geçin</strong> — sağ panelde aktif AI sinyalleri; giriş, hedef,
          stop-loss ve güven skoruyla görünür.
        </li>
        <li>
          <strong>Broker bağlayın (isteğe bağlı)</strong> — bağlantı tamamlanınca tek tık işlem modu
          aktifleşir.
        </li>
      </ol>
    ),
  },
];
