import { eyeLabel } from '../../../model/eye';
import { defaultEye, setDefaultEye } from '../../../state/profiles';
import { EyeRadioGroup } from '../../controls/EyeRadioGroup';

/** Part of the Profiles tab's "Settings" card: the affected eye new profiles start with. */
export function DefaultEyeSetting() {
  const eye = defaultEye.value;
  return (
    <div class="pf-setting">
      <EyeRadioGroup name="eye-default" legend="Default eye for new profiles" value={eye} onChange={(e) => void setDefaultEye(e)} />
      <p class="pf-hint">
        New profiles start as "{eyeLabel(eye)}". Saved profiles keep their own eye; change it above for the open profile.
      </p>
    </div>
  );
}
