import { useMaterialUsage, useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import { chooseMaterialImage, clearMaterialImage, selectPartsUsingMaterial } from '../../actions';
import type { MapProjection, MaterialDef, TextureSlot } from '../../store/types';
import { MaterialBadge } from '../MaterialLibrary';
import {
  Button,
  ColorField,
  EmptyNote,
  Field,
  Hint,
  IconButton,
  Section,
  Select,
  Slider,
  Toggle,
} from '../controls';

const DEG = 180 / Math.PI;

const IMAGE_SLOTS: { slot: TextureSlot; label: string; tip: string }[] = [
  {
    slot: 'map',
    label: 'Colour',
    tip: 'Painted onto the base colour: a label, a logo, a pattern. The base colour still multiplies it, so keep that white to see the image as it is.',
  },
  {
    slot: 'bumpMap',
    label: 'Bump',
    tip: 'A greyscale height image. Light areas read as raised and dark as recessed, which fakes fine relief such as grain or embossing without changing the shape.',
  },
  {
    slot: 'roughnessMap',
    label: 'Roughness',
    tip: 'A greyscale image that varies the roughness across the surface. It multiplies the Roughness value, so leave that near 1 to follow the image.',
  },
  {
    slot: 'normalMap',
    label: 'Normal',
    tip: 'A tangent-space normal map (the blue-purple kind) for relief detail baked in another program.',
  },
];

const PROJECTIONS: { value: MapProjection; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'top', label: 'Top' },
  { value: 'cylinder', label: 'Around (cylinder)' },
];

function ImageSlotRow({
  materialId,
  def,
  slot,
  label,
  tip,
}: {
  materialId: string;
  def: MaterialDef;
  slot: TextureSlot;
  label: string;
  tip: string;
}) {
  const ref = def.maps?.[slot];
  return (
    <Field label={label} tip={tip}>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Button
          className="min-w-0 flex-1 justify-start overflow-hidden"
          tip={ref ? 'Replace this image' : 'Choose a PNG, JPEG or WebP image'}
          label={`${label} image`}
          onClick={() => void chooseMaterialImage(materialId, slot)}
        >
          <span className="truncate">{ref ? ref.name : 'Choose image…'}</span>
        </Button>
        {ref && (
          <IconButton
            icon="trash"
            tip={`Remove the ${label.toLowerCase()} image`}
            onClick={() => clearMaterialImage(materialId, slot)}
          />
        )}
      </div>
    </Field>
  );
}

/**
 * Material properties.
 *
 * Edits the material on the selected object if it has one, otherwise whatever
 * is selected in the library. Properties that the chosen renderer cannot
 * combine are disabled with the reason given, rather than offered as controls
 * that quietly do nothing.
 */
export function MaterialPanel() {
  const selectedNodeId = useUI((state) => state.selectedNodeId);
  const selectedMaterialId = useUI((state) => state.selectedMaterialId);

  const nodeMaterialId = useProject((state) =>
    selectedNodeId ? (state.nodes[selectedNodeId]?.materialId ?? null) : null,
  );
  const nodeIsMeshWithOriginal = useProject((state) => {
    if (!selectedNodeId) return false;
    const node = state.nodes[selectedNodeId];
    return node?.kind === 'mesh' && node.materialId === null;
  });

  const editingId = nodeMaterialId ?? selectedMaterialId;
  const def = useProject((state) => (editingId ? state.materials[editingId] : null));

  const updateMaterial = useProject((state) => state.updateMaterial);
  const renameMaterial = useProject((state) => state.renameMaterial);
  const duplicateMaterial = useProject((state) => state.duplicateMaterial);
  const resetMaterial = useProject((state) => state.resetMaterial);
  const deleteMaterial = useProject((state) => state.deleteMaterial);
  const selectMaterial = useUI((state) => state.selectMaterial);
  const paintBrush = useUI((state) => state.paintBrush);
  const setPaintBrush = useUI((state) => state.setPaintBrush);
  const usage = useMaterialUsage();

  if (nodeIsMeshWithOriginal && !selectedMaterialId) {
    return (
      <EmptyNote>
        This object uses the material that came with the file. Pick one from the
        library below to edit it here, or assign a library material to the object on
        the Object tab.
      </EmptyNote>
    );
  }

  if (!def || !editingId) {
    return (
      <EmptyNote>
        No material selected. Choose one in the Materials window, or select an object that
        has one assigned.
      </EmptyNote>
    );
  }

  const set = (patch: Parameters<typeof updateMaterial>[1], label?: string) =>
    updateMaterial(editingId, patch, label);

  const transmissive = def.transmission > 0;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <MaterialBadge def={def} />
        </div>
        <IconButton
          icon="brush"
          active={paintBrush}
          tone={paintBrush ? 'primary' : 'ghost'}
          tip={
            paintBrush
              ? 'Paint brush on: click parts in the view to give them this material. Click here or press Esc to stop.'
              : 'Paint brush: then click parts in the view to give them this material'
          }
          onClick={() => {
            if (!paintBrush) {
              // The brush follows the picked material, so pin it and let go of the
              // part, whose own material the panel would show instead.
              selectMaterial(editingId);
              useUI.getState().selectNode(null);
            }
            setPaintBrush(!paintBrush);
          }}
        />
      </div>

      <Section title="Material">
        <Field label="Name">
          <input
            value={def.name}
            onChange={(event) => renameMaterial(editingId, event.target.value)}
            className="h-[22px] min-w-0 flex-1 rounded-sm border border-line bg-well px-1.5 text-ctl"
          />
        </Field>
        <Field label="Base colour">
          <ColorField
            value={def.color}
            onChange={(color) => set({ color }, `material-${editingId}-color`)}
          />
        </Field>
      </Section>

      <Section title="Surface">
        <Slider
          label="Metallic"
          tip="0 is a dielectric such as plastic or paint; 1 is bare metal, which takes nearly all of its colour from reflections."
          value={def.metalness}
          onChange={(metalness) => set({ metalness }, `material-${editingId}-metalness`)}
          defaultValue={0}
        />
        <Slider
          label="Roughness"
          tip="How wide the reflection spreads. Low is mirror-like, high is matte."
          value={def.roughness}
          onChange={(roughness) => set({ roughness }, `material-${editingId}-roughness`)}
          defaultValue={0.5}
        />
        <Slider
          label="Reflection"
          tip="Scales how strongly this material picks up the environment."
          value={def.envMapIntensity}
          onChange={(envMapIntensity) =>
            set({ envMapIntensity }, `material-${editingId}-env`)
          }
          min={0}
          max={3}
          step={0.05}
          defaultValue={1}
        />
      </Section>

      <Section
        key={`images-${editingId}`}
        title="Images"
        defaultOpen={Object.keys(def.maps ?? {}).length > 0}
        hint="Colour images for labels and logos, and bump, roughness or normal maps for surface detail."
      >
        {IMAGE_SLOTS.map((entry) => (
          <ImageSlotRow key={entry.slot} materialId={editingId} def={def} {...entry} />
        ))}
        {Object.keys(def.maps ?? {}).length > 0 && (
          <>
            {def.maps.bumpMap && (
              <Slider
                label="Bump strength"
                value={def.bumpScale}
                onChange={(bumpScale) => set({ bumpScale }, `material-${editingId}-bump`)}
                min={0}
                max={5}
                step={0.05}
                defaultValue={1}
              />
            )}
            {def.maps.normalMap && (
              <Slider
                label="Normal strength"
                value={def.normalScale}
                onChange={(normalScale) => set({ normalScale }, `material-${editingId}-nscale`)}
                min={0}
                max={3}
                step={0.05}
                defaultValue={1}
              />
            )}
            <Field
              label="Projection"
              tip="How the image meets the part. Auto uses the model's own UV coordinates when it has them and projects from the front when it doesn't. The others project onto the part's bounding box."
            >
              <Select<MapProjection>
                value={def.mapProjection}
                onChange={(mapProjection) => set({ mapProjection }, `material-${editingId}-proj`)}
                options={PROJECTIONS}
              />
            </Field>
            <Field
              label="Front side only"
              tip="Show the images only on the faces that face the projection, such as the outside of a label, and leave the back and edges plain. It needs a projection (Front, Side, Top or Around); parts that use the model's own UV coordinates are unaffected."
            >
              <Toggle
                checked={def.mapSingleSided}
                onChange={(mapSingleSided) =>
                  set({ mapSingleSided }, `material-${editingId}-single`)
                }
                label="Front side only"
              />
            </Field>
            <Slider
              label="Repeat X"
              tip="1 fits the image across the part exactly; higher tiles it."
              value={def.mapRepeat[0]}
              onChange={(x) => set({ mapRepeat: [x, def.mapRepeat[1]] }, `material-${editingId}-rx`)}
              min={0.1}
              max={10}
              step={0.05}
              defaultValue={1}
            />
            <Slider
              label="Repeat Y"
              value={def.mapRepeat[1]}
              onChange={(y) => set({ mapRepeat: [def.mapRepeat[0], y] }, `material-${editingId}-ry`)}
              min={0.1}
              max={10}
              step={0.05}
              defaultValue={1}
            />
            <Slider
              label="Offset X"
              value={def.mapOffset[0]}
              onChange={(x) => set({ mapOffset: [x, def.mapOffset[1]] }, `material-${editingId}-ox`)}
              min={-1}
              max={1}
              step={0.005}
              decimals={3}
              defaultValue={0}
            />
            <Slider
              label="Offset Y"
              value={def.mapOffset[1]}
              onChange={(y) => set({ mapOffset: [def.mapOffset[0], y] }, `material-${editingId}-oy`)}
              min={-1}
              max={1}
              step={0.005}
              decimals={3}
              defaultValue={0}
            />
            <Slider
              label="Rotation"
              value={def.mapRotation}
              onChange={(mapRotation) => set({ mapRotation }, `material-${editingId}-rot`)}
              min={-180}
              max={180}
              step={1}
              decimals={0}
              suffix="°"
              defaultValue={0}
            />
            <Hint>
              Edits apply to every object using this material. Duplicate it first to put a
              different image on a single part.
            </Hint>
          </>
        )}
      </Section>

      <Section key={`coat-${editingId}`} title="Coating" defaultOpen={def.clearcoat > 0}>
        <Slider
          label="Clearcoat"
          tip="A thin glossy layer over the surface, as on car paint or glazed ceramic."
          value={def.clearcoat}
          onChange={(clearcoat) => set({ clearcoat }, `material-${editingId}-clearcoat`)}
          defaultValue={0}
        />
        <Slider
          label="Coat roughness"
          value={def.clearcoatRoughness}
          onChange={(clearcoatRoughness) =>
            set({ clearcoatRoughness }, `material-${editingId}-ccr`)
          }
          disabled={def.clearcoat === 0}
          defaultValue={0.05}
        />
        <Slider
          label="Anisotropy"
          tip="Stretches reflections in one direction, the way brushing or machining a metal does."
          value={def.anisotropy}
          onChange={(anisotropy) => set({ anisotropy }, `material-${editingId}-aniso`)}
          defaultValue={0}
        />
        <Slider
          label="Brush angle"
          value={def.anisotropyRotation * DEG}
          onChange={(degrees) =>
            set(
              { anisotropyRotation: degrees / DEG },
              `material-${editingId}-aniso-rot`,
            )
          }
          min={0}
          max={180}
          step={1}
          decimals={0}
          suffix="°"
          disabled={def.anisotropy === 0}
        />
      </Section>

      <Section
        key={`transparency-${editingId}`}
        title="Transparency"
        defaultOpen={def.transmission > 0 || def.opacity < 1}
      >
        <Slider
          label="Transmission"
          tip="Light passing through the material, with refraction. This is what makes glass."
          value={def.transmission}
          onChange={(transmission) =>
            set({ transmission }, `material-${editingId}-transmission`)
          }
          defaultValue={0}
        />
        <Slider
          label="Opacity"
          value={def.opacity}
          onChange={(opacity) => set({ opacity }, `material-${editingId}-opacity`)}
          disabled={transmissive}
          defaultValue={1}
          note={
            transmissive
              ? 'Blended opacity is unavailable while transmission is above zero — use thickness instead.'
              : undefined
          }
        />
        <Slider
          label="Refraction"
          tip="Index of refraction. Glass is about 1.5, water 1.33, diamond 2.4."
          value={def.ior}
          onChange={(ior) => set({ ior }, `material-${editingId}-ior`)}
          min={1}
          max={2.5}
          step={0.01}
          disabled={!transmissive}
          defaultValue={1.5}
        />
        <Slider
          label="Thickness"
          tip="How far light travels inside the material. Larger values bend and tint more."
          value={def.thickness}
          onChange={(thickness) => set({ thickness }, `material-${editingId}-thickness`)}
          min={0}
          max={5}
          step={0.05}
          disabled={!transmissive}
          defaultValue={0.5}
        />
      </Section>

      <Section key={`sheen-${editingId}`} title="Sheen" defaultOpen={def.sheen > 0} hint="A soft edge glow, as on fabric and rubber.">
        <Slider
          label="Sheen"
          value={def.sheen}
          onChange={(sheen) => set({ sheen }, `material-${editingId}-sheen`)}
          defaultValue={0}
        />
        <Slider
          label="Sheen roughness"
          value={def.sheenRoughness}
          onChange={(sheenRoughness) =>
            set({ sheenRoughness }, `material-${editingId}-sheen-r`)
          }
          disabled={def.sheen === 0}
          defaultValue={0.4}
        />
        <Field label="Sheen colour">
          <ColorField
            value={def.sheenColor}
            onChange={(sheenColor) => set({ sheenColor })}
            disabled={def.sheen === 0}
          />
        </Field>
      </Section>

      <Section
        key={`sss-${editingId}`}
        title="Subsurface scattering"
        defaultOpen={def.sssRadius > 0}
        hint="Light enters the material and scatters inside it before coming out: wax, skin, marble, milk, jade. Path traced views only (the fast viewport shows a plain surface). Needs a closed model. While on, transmission, thickness and attenuation are not used."
      >
        <Slider
          label="Scatter radius"
          value={def.sssRadius}
          onChange={(sssRadius) => set({ sssRadius }, `material-${editingId}-sss`)}
          max={1}
          step={0.01}
          decimals={2}
          defaultValue={0}
        />
      </Section>

      <Section
        key={`emission-${editingId}`}
        title="Emission"
        defaultOpen={def.emissiveIntensity > 0}
        hint="Light given off by the surface. In path traced views it also lights the scene around it; the fast viewport shows only the glowing surface."
      >
        <Slider
          label="Intensity"
          value={def.emissiveIntensity}
          onChange={(emissiveIntensity) =>
            set({ emissiveIntensity }, `material-${editingId}-emission`)
          }
          max={20}
          step={0.1}
          decimals={1}
          defaultValue={0}
        />
        <Field label="Emission colour">
          <ColorField
            value={def.emissive}
            onChange={(emissive) => set({ emissive })}
            disabled={def.emissiveIntensity === 0}
          />
        </Field>
      </Section>

      <Section title="Shading" defaultOpen={false}>
        <Field
          label="Double-sided"
          tip="Render back faces too. Needed for open shells and for most glass."
        >
          <Toggle
            checked={def.doubleSided}
            onChange={(doubleSided) => set({ doubleSided })}
            label="Double-sided"
          />
        </Field>
        <Field label="Flat shading" tip="Shade each triangle flat, showing the facets.">
          <Toggle
            checked={def.flatShading}
            onChange={(flatShading) => set({ flatShading })}
            label="Flat shading"
          />
        </Field>
      </Section>

      <div className="px-2.5 pt-2.5 text-label text-ink-dim">
        {(usage[editingId] ?? 0) === 0
          ? 'Not used on any part'
          : `Used on ${usage[editingId]} ${usage[editingId] === 1 ? 'part' : 'parts'}`}
      </div>
      <div className="flex flex-wrap gap-1.5 p-2.5">
        <Button
          icon="cube"
          disabled={(usage[editingId] ?? 0) === 0}
          onClick={() => selectPartsUsingMaterial(editingId)}
          tip="Select every part that uses this material"
        >
          Select parts
        </Button>
        <Button
          icon="copy"
          onClick={() => {
            const id = duplicateMaterial(editingId);
            if (id) selectMaterial(id);
          }}
        >
          Duplicate
        </Button>
        <Button
          icon="reset"
          onClick={() => resetMaterial(editingId)}
          tip={
            def.presetId
              ? 'Restore this material to its library values'
              : 'Restore the default material values'
          }
        >
          Reset
        </Button>
        {!def.builtIn && (
          <Button
            tone="danger"
            icon="trash"
            onClick={() => {
              deleteMaterial(editingId);
              selectMaterial(null);
            }}
          >
            Delete
          </Button>
        )}
      </div>

      {def.builtIn && (
        <div className="px-2.5 pb-3">
          <Hint>
            A library material. Edits apply to every object using it;
            duplicate it first to vary a single object.
          </Hint>
        </div>
      )}
    </>
  );
}
