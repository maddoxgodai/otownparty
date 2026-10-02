import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import SwipeDeck from "@/components/partner/SwipeDeck";
import Inbox from "@/components/partner/Inbox";
import ChatPanel from "@/components/partner/ChatPanel";
import NewMatchPopup from "@/components/partner/NewMatchPopup";
import { usePartnerInbox, type InboxMatch } from "@/hooks/usePartnerInbox";
import { Loader2, Upload, X, Heart, Inbox as InboxIcon, UserRound } from "lucide-react";

// NOTE: `partner_profiles`, `partner_matches` etc. are new tables that don't
// exist in src/integrations/supabase/types.ts yet. These `as any` casts can
// be removed once types.ts is regenerated against the real schema.
const db = supabase as any;

type ProfileStatus = "none" | "pending" | "approved" | "rejected" | "disabled";

type PartnerProfile = {
  id: string;
  user_id: string;
  display_name: string;
  age: number;
  gender: string;
  looking_for: string[];
  bio: string;
  photo_urls: string[];
  status: ProfileStatus;
  reject_reason?: string | null;
};

const GENDERS = ["Male", "Female"];
const LOOKING_FOR_OPTIONS = ["Male", "Female", "Anyone"];

// A simple, friendly device lock: one browser/device = one account. This
// isn't unbeatable (clearing site data resets it), but it stops casual
// account-switching, which is the goal here.
const DEVICE_ID_KEY = "otown_partner_device_id";
const getDeviceId = () => {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

const Partner = () => {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const deviceId = useMemo(getDeviceId, []);

  // email/otp step
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<"email" | "otp">("email");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // profile
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [agreedDisclaimer, setAgreedDisclaimer] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // form fields
  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [lookingFor, setLookingFor] = useState<string[]>([]);
  const [bio, setBio] = useState("");
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // tabs + chat
  const [tab, setTab] = useState<"swipe" | "inbox" | "profile">("swipe");
  const [openMatch, setOpenMatch] = useState<InboxMatch | null>(null);
  const [chatMinimized, setChatMinimized] = useState(false);

  const { matches, loading: inboxLoading, totalUnread, markRead, newMatch, clearNewMatch, reload } =
    usePartnerInbox(session?.user?.id, chatMinimized ? null : openMatch?.id ?? null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) fetchProfile();
  }, [session?.user?.id]);

  const fetchProfile = async () => {
    setProfileLoading(true);
    const { data, error } = await db
      .from("partner_profiles")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) console.error(error);
    setProfile(data ?? null);
    setProfileLoading(false);
  };

  const fnError = async (error: any, data: any) => {
    if (data?.error) return data.error;
    try {
      const body = await error?.context?.json?.();
      if (body?.error) return body.error;
    } catch {}
    return error?.message ?? "Something went wrong";
  };

  const sendOtp = async () => {
    if (!email.trim()) return toast.error("Enter your email first");
    setSendingOtp(true);
    const { data, error } = await supabase.functions.invoke("send-partner-otp", {
      body: { email: email.trim(), device_id: deviceId },
    });
    setSendingOtp(false);
    if (error || data?.error) return toast.error(await fnError(error, data));
    toast.success("Code sent! Check your email.");
    setOtp("");
    setAuthStep("otp");
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) return toast.error("Enter the 6-digit code");
    setVerifyingOtp(true);
    const { data, error } = await supabase.functions.invoke("verify-partner-otp", {
      body: { email: email.trim(), code: otp, device_id: deviceId },
    });
    if (error || !data?.token_hash) {
      setVerifyingOtp(false);
      return toast.error(await fnError(error, data));
    }
    const { error: authErr } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: "email",
    });
    setVerifyingOtp(false);
    if (authErr) return toast.error(authErr.message);
  };

  const startEdit = () => {
    if (profile) {
      setDisplayName(profile.display_name);
      setAge(String(profile.age));
      setGender(profile.gender);
      setLookingFor(profile.looking_for ?? []);
      setBio(profile.bio);
      setExistingPhotoUrls(profile.photo_urls ?? []);
    }
    setPhotos([]);
    setPhotoPreviews([]);
    setShowForm(true);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slotsLeft = 3 - existingPhotoUrls.length - photos.length;
    const files = Array.from(e.target.files ?? []).slice(0, Math.max(0, slotsLeft));
    if (!files.length) return;
    setPhotos((p) => [...p, ...files]);
    files.forEach((f) => {
      const url = URL.createObjectURL(f);
      setPhotoPreviews((p) => [...p, url]);
    });
  };

  const removeExistingPhoto = (idx: number) => {
    setExistingPhotoUrls((p) => p.filter((_, i) => i !== idx));
  };

  const removeNewPhoto = (idx: number) => {
    setPhotos((p) => p.filter((_, i) => i !== idx));
    setPhotoPreviews((p) => p.filter((_, i) => i !== idx));
  };

  const toggleLookingFor = (opt: string) => {
    setLookingFor((cur) =>
      cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]
    );
  };

  const submitProfile = async () => {
    if (!displayName.trim() || !age || !gender || lookingFor.length === 0 || !bio.trim()) {
      return toast.error("Fill in every field");
    }
    if (Number(age) < 18) return toast.error("You must be 18 or older");
    if (existingPhotoUrls.length + photos.length === 0) {
      return toast.error("Add at least one photo");
    }

    setSubmitting(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of photos) {
        const path = `${session.user.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("partner-photos")
          .upload(path, file);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("partner-photos").getPublicUrl(path);
        uploadedUrls.push(data.publicUrl);
      }

      const { error } = await db.from("partner_profiles").upsert(
        {
          user_id: session.user.id,
          display_name: displayName.trim(),
          age: Number(age),
          gender,
          looking_for: lookingFor,
          bio: bio.trim(),
          photo_urls: [...existingPhotoUrls, ...uploadedUrls].slice(0, 3),
          status: "pending",
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;

      toast.success("Profile submitted! We'll review it shortly.");
      setShowForm(false);
      fetchProfile();
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const openChat = (m: InboxMatch) => {
    setOpenMatch(m);
    setChatMinimized(false);
    clearNewMatch();
  };

  // ---------- RENDER ----------

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 pt-32 pb-20 max-w-xl">
        <h1 className="font-display text-3xl md:text-4xl mb-2 text-gradient-brand">
          Find a Partner 🥲
        </h1>
        <p className="text-foreground/60 mb-10">
          Swipe to find someone to come to the party with. Platonic or not — your call.
        </p>

        {!session && (
          <div className="bg-card border border-border rounded-xl p-6 animate-fade-up">
            {authStep === "email" ? (
              <div className="space-y-4">
                <label className="text-sm text-foreground/70">Your email</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                />
                <Button className="w-full" onClick={sendOtp} disabled={sendingOtp}>
                  {sendingOtp ? <Loader2 className="animate-spin" size={16} /> : "Send code"}
                </Button>
                <p className="text-xs text-foreground/40 text-center">
                  One account per device — keep it fair for everyone 🙂
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="text-sm text-foreground/70">
                  Enter the 6-digit code sent to {email}
                </label>
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    {[...Array(6)].map((_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
                <Button className="w-full" onClick={verifyOtp} disabled={verifyingOtp}>
                  {verifyingOtp ? <Loader2 className="animate-spin" size={16} /> : "Verify"}
                </Button>
                <button
                  className="text-sm text-foreground/50 hover:text-primary"
                  onClick={() => setAuthStep("email")}
                >
                  Use a different email
                </button>
              </div>
            )}
          </div>
        )}

        {session && profileLoading && (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}

        {session && !profileLoading && !profile && !showForm && !agreedDisclaimer && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-4 animate-fade-up">
            <h2 className="font-display text-xl">Before you continue</h2>
            <p className="text-sm text-foreground/70 leading-relaxed">
              You must be 18 or older. Meet new people safely — prefer public meeting
              spots, tell a friend where you're going, and trust your judgement.
              Otown Party isn't responsible for what happens off-platform.
            </p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={agreedDisclaimer}
                onCheckedChange={(v) => setAgreedDisclaimer(!!v)}
              />
              I confirm I'm 18 or older and I've read this
            </label>
            <Button
              className="w-full"
              disabled={!agreedDisclaimer}
              onClick={() => setShowForm(true)}
            >
              Continue
            </Button>
          </div>
        )}

        {session && !profileLoading && (!profile || profile.status === "rejected" || (profile.status === "approved" && showForm)) && showForm && (
          <div className="bg-card border border-border rounded-xl p-6 space-y-5 animate-fade-up">
            <h2 className="font-display text-xl">
              {profile ? "Edit your profile" : "Create your profile"}
            </h2>

            <div>
              <label className="text-sm text-foreground/70 block mb-1">Name</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm text-foreground/70 block mb-1">Age</label>
                <Input type="number" min={18} value={age} onChange={(e) => setAge(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="text-sm text-foreground/70 block mb-1">Gender</label>
                <div className="flex gap-2">
                  {GENDERS.map((g) => (
                    <button
                      key={g}
                      onClick={() => setGender(g)}
                      className={`px-3 py-2 rounded-lg text-sm border ${
                        gender === g
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-foreground/70"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="text-sm text-foreground/70 block mb-1">Looking for</label>
              <div className="flex gap-2 flex-wrap">
                {LOOKING_FOR_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => toggleLookingFor(opt)}
                    className={`px-3 py-2 rounded-lg text-sm border ${
                      lookingFor.includes(opt)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-foreground/70"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-foreground/70 block mb-1">
                Bio ({bio.length}/150)
              </label>
              <Textarea
                maxLength={150}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell people a bit about yourself..."
              />
            </div>

            <div>
              <label className="text-sm text-foreground/70 block mb-2">
                Photos ({existingPhotoUrls.length + photos.length}/3)
              </label>
              <div className="flex gap-3 flex-wrap">
                {existingPhotoUrls.map((url, i) => (
                  <div key={`existing-${i}`} className="relative w-20 h-20">
                    <img src={url} className="w-full h-full object-cover rounded-lg" />
                    <button
                      onClick={() => removeExistingPhoto(i)}
                      className="absolute -top-2 -right-2 bg-destructive rounded-full p-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {photoPreviews.map((url, i) => (
                  <div key={`new-${i}`} className="relative w-20 h-20">
                    <img src={url} className="w-full h-full object-cover rounded-lg" />
                    <button
                      onClick={() => removeNewPhoto(i)}
                      className="absolute -top-2 -right-2 bg-destructive rounded-full p-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {existingPhotoUrls.length + photos.length < 3 && (
                  <label className="w-20 h-20 border border-dashed border-border rounded-lg flex items-center justify-center cursor-pointer text-foreground/50 hover:text-primary hover:border-primary">
                    <Upload size={18} />
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoSelect}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {profile?.status === "approved" && (
                <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              )}
              <Button className="flex-1" onClick={submitProfile} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" size={16} /> : "Submit for review"}
              </Button>
            </div>
          </div>
        )}

        {session && !profileLoading && profile?.status === "pending" && (
          <div className="bg-card border border-border rounded-xl p-6 text-center animate-fade-up">
            <p className="font-display text-lg mb-1">Your profile is under review ⏳</p>
            <p className="text-sm text-foreground/60">
              We manually check every photo before you go live. Shouldn't take long.
            </p>
          </div>
        )}

        {session && !profileLoading && profile?.status === "rejected" && !showForm && (
          <div className="bg-card border border-border rounded-xl p-6 text-center space-y-3 animate-fade-up">
            <p className="font-display text-lg">Your profile needs a tweak</p>
            {profile.reject_reason && (
              <p className="text-sm text-foreground/60">{profile.reject_reason}</p>
            )}
            <Button onClick={startEdit}>Edit & resubmit</Button>
          </div>
        )}

        {session && !profileLoading && profile?.status === "disabled" && (
          <div className="bg-card border border-border rounded-xl p-6 text-center">
            <p className="text-sm text-foreground/60">
              Your profile has been disabled. Contact us if you think this is a mistake.
            </p>
          </div>
        )}

        {session && !profileLoading && profile?.status === "approved" && !showForm && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid grid-cols-3 w-full mb-6">
              <TabsTrigger value="swipe" className="gap-1.5">
                <Heart size={14} /> Swipe
              </TabsTrigger>
              <TabsTrigger value="inbox" className="gap-1.5 relative">
                <InboxIcon size={14} /> Inbox
                {totalUnread > 0 && (
                  <span className="ml-1 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                    {totalUnread}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="profile" className="gap-1.5">
                <UserRound size={14} /> My Profile
              </TabsTrigger>
            </TabsList>

            <TabsContent value="swipe">
              <SwipeDeck currentUserId={session.user.id} />
            </TabsContent>

            <TabsContent value="inbox">
              <Inbox
                matches={matches}
                loading={inboxLoading}
                currentUserId={session.user.id}
                onOpen={openChat}
                onDiscover={() => setTab("swipe")}
              />
            </TabsContent>

            <TabsContent value="profile">
              <div className="bg-card border border-border rounded-xl overflow-hidden animate-fade-up">
                {profile.photo_urls?.[0] && (
                  <img src={profile.photo_urls[0]} className="w-full h-64 object-cover" />
                )}
                <div className="p-5 space-y-3">
                  <div>
                    <h3 className="font-display text-xl">
                      {profile.display_name}, {profile.age}
                    </h3>
                    <p className="text-xs text-foreground/50">{profile.gender}</p>
                  </div>
                  <p className="text-sm text-foreground/70">{profile.bio}</p>
                  <p className="text-xs text-foreground/50">
                    Looking for: {profile.looking_for.join(", ")}
                  </p>
                  {profile.photo_urls?.length > 1 && (
                    <div className="flex gap-2">
                      {profile.photo_urls.slice(1).map((url, i) => (
                        <img key={i} src={url} className="w-16 h-16 rounded-lg object-cover" />
                      ))}
                    </div>
                  )}
                  <Button variant="outline" className="w-full" onClick={startEdit}>
                    Edit profile
                  </Button>
                  <p className="text-xs text-foreground/40 text-center pt-1">
                    Editing sends your profile back for a quick re-review.
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>

      {openMatch && session && (
        <ChatPanel
          match={openMatch}
          currentUserId={session.user.id}
          minimized={chatMinimized}
          unread={matches.find((m) => m.id === openMatch.id)?.unread ?? 0}
          onMinimize={() => setChatMinimized(true)}
          onRestore={() => setChatMinimized(false)}
          onClose={() => {
            setOpenMatch(null);
            setChatMinimized(false);
            reload();
          }}
          onRead={() => markRead(openMatch.id)}
        />
      )}

      {newMatch && session && !openMatch && (
        <NewMatchPopup
          match={newMatch}
          onSayHi={() => openChat(newMatch)}
          onKeepSwiping={() => clearNewMatch()}
        />
      )}

      <Footer />
    </div>
  );
};

export default Partner;
