"use client";

import { type FormEvent, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "~/components/ui/native-select";
import { Textarea } from "~/components/ui/textarea";
import { FieldError } from "~/components/ui/field";
import { api } from "~/trpc/react";
import { CapacityConflicts } from "./capacity-conflicts";
import { formNumberValue, formValue } from "./form-values";
import { PanaceaQueryError, PanaceaQueryLoading } from "./panacea-query-state";

type PendingOfferUpdate = {
  input: {
    bufferMinutes: number;
    durationMinutes: number;
    offerId: string;
    priceUsd: string;
  };
  previous: {
    bufferMinutes: number;
    durationMinutes: number;
  };
};

export function ServiceCatalogSection({
  canManageServices,
  canManageOffers = canManageServices,
}: {
  canManageServices: boolean;
  canManageOffers?: boolean;
}) {
  const [result, setResult] = useState<string>();
  const [offerToDeactivate, setOfferToDeactivate] = useState<string>();
  const [offerToUpdate, setOfferToUpdate] = useState<PendingOfferUpdate>();
  const [addErrorServiceId, setAddErrorServiceId] = useState<string>();
  const [serviceUpdateErrorId, setServiceUpdateErrorId] = useState<string>();
  const [offerUpdateErrorId, setOfferUpdateErrorId] = useState<string>();
  const catalog = api.panacea.listServiceCatalog.useQuery();
  const create = api.panacea.createService.useMutation({
    onSuccess: (service) => {
      setResult(`Servicio ${service.name} creado.`);
      void catalog.refetch();
    },
    onError: () => setResult(undefined),
  });
  const add = api.panacea.addServiceOffer.useMutation({
    onSuccess: () => {
      setAddErrorServiceId(undefined);
      setResult("Oferta agregada al Servicio.");
      void catalog.refetch();
    },
    onError: () => setResult(undefined),
  });
  const updateServiceMutation = api.panacea.updateService.useMutation({
    onSuccess: (service) => {
      setServiceUpdateErrorId(undefined);
      setResult(`Servicio ${service.name} actualizado.`);
      void catalog.refetch();
    },
    onError: () => setResult(undefined),
  });
  const update = api.panacea.updateServiceOffer.useMutation({
    onSuccess: () => {
      setOfferUpdateErrorId(undefined);
      setResult("Oferta actualizada para opciones nuevas.");
      void catalog.refetch();
    },
    onError: () => setResult(undefined),
  });
  const deactivate = api.panacea.deactivateServiceOffer.useMutation({
    onSuccess: () => {
      setResult("Oferta desactivada sin borrar su historial.");
      void catalog.refetch();
    },
    onError: () => setResult(undefined),
  });
  const queryError = catalog.error;
  const createErrorId = "service-catalog-create-error";
  const createFieldProps = create.error
    ? ({
        "aria-describedby": createErrorId,
        "aria-invalid": true,
      } as const)
    : {};
  const deactivateErrorId = "service-catalog-deactivate-error";

  function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    create.mutate({
      description: formValue(data, "description"),
      name: formValue(data, "name"),
      offers: [
        {
          bufferMinutes: formNumberValue(data, "bufferMinutes"),
          doctorId: formValue(data, "doctorId"),
          durationMinutes: formNumberValue(data, "durationMinutes"),
          priceUsd: formValue(data, "priceUsd"),
        },
      ],
    });
  }

  function updateOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = {
      bufferMinutes: formNumberValue(data, "bufferMinutes"),
      durationMinutes: formNumberValue(data, "durationMinutes"),
      offerId: formValue(data, "offerId"),
      priceUsd: formValue(data, "priceUsd"),
    };
    const currentOffer = catalog.data?.services
      .flatMap((service) => service.offers)
      .find((offer) => offer.id === input.offerId);
    if (
      currentOffer === undefined ||
      (currentOffer.bufferMinutes === input.bufferMinutes &&
        currentOffer.durationMinutes === input.durationMinutes)
    ) {
      setOfferUpdateErrorId(input.offerId);
      update.mutate(input);
      return;
    }
    setOfferToUpdate({
      input,
      previous: {
        bufferMinutes: currentOffer.bufferMinutes,
        durationMinutes: currentOffer.durationMinutes,
      },
    });
  }

  function updateServiceInfo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const serviceId = formValue(data, "serviceId");
    setServiceUpdateErrorId(serviceId);
    updateServiceMutation.mutate({
      description: formValue(data, "description"),
      name: formValue(data, "name"),
      serviceId,
    });
  }

  function addOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const serviceId = formValue(data, "serviceId");
    setAddErrorServiceId(serviceId);
    add.mutate({
      bufferMinutes: formNumberValue(data, "bufferMinutes"),
      doctorId: formValue(data, "doctorId"),
      durationMinutes: formNumberValue(data, "durationMinutes"),
      priceUsd: formValue(data, "priceUsd"),
      serviceId,
    });
  }

  return (
    <section className="border-border bg-card text-card-foreground space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="text-xl font-semibold">Catálogo de Servicios</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Cada Servicio comienza con una Oferta activa de un Médico elegible.
        </p>
      </div>
      {queryError ? (
        <PanaceaQueryError
          error={queryError}
          onRetry={() => void catalog.refetch()}
          title="Servicios"
        />
      ) : catalog.isLoading ? (
        <PanaceaQueryLoading label="Cargando Servicios" />
      ) : null}
      {canManageServices ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={createService}>
          <label className="block text-sm">
            Servicio
            <Input
              {...createFieldProps}
              className="mt-1"
              maxLength={120}
              name="name"
              required
            />
          </label>
          <label className="block text-sm">
            Médico
            <NativeSelect
              {...createFieldProps}
              className="mt-1 w-full"
              disabled={catalog.data?.doctors.length === 0}
              name="doctorId"
              required
            >
              {catalog.data?.doctors.map((doctor) => (
                <NativeSelectOption key={doctor.id} value={doctor.id}>
                  {doctor.publicName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="block text-sm sm:col-span-2">
            Descripción pública
            <Textarea
              {...createFieldProps}
              className="mt-1 min-h-24"
              maxLength={1000}
              name="description"
              required
            />
          </label>
          <label className="block text-sm">
            Precio (USD)
            <Input
              {...createFieldProps}
              className="mt-1"
              inputMode="decimal"
              name="priceUsd"
              pattern="[0-9]+\.[0-9]{2}"
              placeholder="35.00"
              required
            />
          </label>
          <label className="block text-sm">
            Duración (minutos)
            <Input
              {...createFieldProps}
              className="mt-1"
              defaultValue="30"
              min="5"
              name="durationMinutes"
              required
              step="5"
              type="number"
            />
          </label>
          <label className="block text-sm">
            Buffer posterior (minutos)
            <Input
              {...createFieldProps}
              className="mt-1"
              defaultValue="0"
              min="0"
              name="bufferMinutes"
              required
              step="5"
              type="number"
            />
          </label>
          <Button
            disabled={create.isPending || catalog.data?.doctors.length === 0}
            type="submit"
          >
            {create.isPending ? "Creando…" : "Crear Servicio"}
          </Button>
          {create.error ? (
            <FieldError className="sm:col-span-2" id={createErrorId}>
              {create.error.message}
            </FieldError>
          ) : null}
        </form>
      ) : null}
      {canManageServices && catalog.data?.doctors.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Invite y active al menos un Médico antes de crear un Servicio.
        </p>
      ) : null}
      {!catalog.isLoading &&
      !queryError &&
      catalog.data?.services.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
          No hay Servicios configurados todavía.
        </p>
      ) : null}
      {result ? (
        <p className="text-muted-foreground text-sm" role="status">
          {result}
        </p>
      ) : null}
      {deactivate.error ? (
        <div className="text-destructive space-y-2 text-sm">
          <FieldError id={deactivateErrorId}>
            {deactivate.error.message}
          </FieldError>
          <CapacityConflicts
            conflicts={deactivate.error?.data?.capacityConflicts}
          />
        </div>
      ) : null}
      <div className="space-y-3">
        {catalog.data?.services.map((service) => (
          <article
            className="border-border rounded-lg border p-4"
            key={service.id}
          >
            <h3 className="font-medium">{service.name}</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              {service.description}
            </p>
            {canManageServices ? (
              <form
                aria-label={`Editar Servicio ${service.name}`}
                className="mt-3 grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
                onSubmit={updateServiceInfo}
              >
                <input name="serviceId" type="hidden" value={service.id} />
                <label className="text-sm">
                  Nombre del Servicio
                  <Input
                    {...(updateServiceMutation.error !== undefined &&
                    serviceUpdateErrorId === service.id
                      ? {
                          "aria-describedby": `service-catalog-update-${service.id}-error`,
                          "aria-invalid": true,
                        }
                      : {})}
                    className="mt-1"
                    defaultValue={service.name}
                    maxLength={120}
                    name="name"
                    required
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  Descripción pública
                  <Textarea
                    {...(updateServiceMutation.error !== undefined &&
                    serviceUpdateErrorId === service.id
                      ? {
                          "aria-describedby": `service-catalog-update-${service.id}-error`,
                          "aria-invalid": true,
                        }
                      : {})}
                    className="mt-1 min-h-20"
                    defaultValue={service.description}
                    maxLength={1000}
                    name="description"
                    required
                  />
                </label>
                <Button
                  className="w-fit"
                  disabled={updateServiceMutation.isPending}
                  type="submit"
                >
                  {updateServiceMutation.isPending
                    ? "Guardando…"
                    : "Guardar Servicio"}
                </Button>
                {updateServiceMutation.error !== undefined &&
                serviceUpdateErrorId === service.id ? (
                  <FieldError
                    className="sm:col-span-2"
                    id={`service-catalog-update-${service.id}-error`}
                  >
                    {updateServiceMutation.error?.message}
                  </FieldError>
                ) : null}
              </form>
            ) : null}
            {canManageOffers ? (
              <form
                className="mt-3 grid items-end gap-2 rounded border p-3 sm:grid-cols-4"
                onSubmit={addOffer}
              >
                <input name="serviceId" type="hidden" value={service.id} />
                <label className="text-sm">
                  Médico
                  <NativeSelect
                    {...(add.error !== undefined &&
                    addErrorServiceId === service.id
                      ? {
                          "aria-describedby": `service-catalog-add-${service.id}-error`,
                          "aria-invalid": true,
                        }
                      : {})}
                    className="mt-1 w-full"
                    name="doctorId"
                    required
                  >
                    {catalog.data?.doctors.map((doctor) => (
                      <NativeSelectOption key={doctor.id} value={doctor.id}>
                        {doctor.publicName}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <label className="text-sm">
                  Precio (USD)
                  <Input
                    {...(add.error !== undefined &&
                    addErrorServiceId === service.id
                      ? {
                          "aria-describedby": `service-catalog-add-${service.id}-error`,
                          "aria-invalid": true,
                        }
                      : {})}
                    className="mt-1"
                    defaultValue="0.00"
                    name="priceUsd"
                    pattern="[0-9]+\.[0-9]{2}"
                    required
                  />
                </label>
                <label className="text-sm">
                  Duración
                  <Input
                    {...(add.error !== undefined &&
                    addErrorServiceId === service.id
                      ? {
                          "aria-describedby": `service-catalog-add-${service.id}-error`,
                          "aria-invalid": true,
                        }
                      : {})}
                    className="mt-1"
                    defaultValue="30"
                    min="5"
                    name="durationMinutes"
                    required
                    step="5"
                    type="number"
                  />
                </label>
                <label className="text-sm">
                  Buffer
                  <Input
                    {...(add.error !== undefined &&
                    addErrorServiceId === service.id
                      ? {
                          "aria-describedby": `service-catalog-add-${service.id}-error`,
                          "aria-invalid": true,
                        }
                      : {})}
                    className="mt-1"
                    defaultValue="0"
                    min="0"
                    name="bufferMinutes"
                    required
                    step="5"
                    type="number"
                  />
                </label>
                <Button
                  className="w-fit"
                  disabled={add.isPending}
                  type="submit"
                >
                  {add.isPending ? "Agregando…" : "Agregar Oferta"}
                </Button>
                {add.error !== undefined && addErrorServiceId === service.id ? (
                  <FieldError
                    className="sm:col-span-4"
                    id={`service-catalog-add-${service.id}-error`}
                  >
                    {add.error?.message}
                  </FieldError>
                ) : null}
              </form>
            ) : null}
            <div className="mt-3 space-y-3">
              {service.offers.map((offer) => {
                const doctorName =
                  catalog.data?.doctors.find(
                    (doctor) => doctor.id === offer.doctorId,
                  )?.publicName ?? "Médico";
                return (
                  <form
                    aria-label={`Oferta de ${doctorName}`}
                    className="grid items-end gap-2 rounded border p-3 sm:grid-cols-4"
                    key={offer.id}
                    onSubmit={updateOffer}
                  >
                    <input name="offerId" type="hidden" value={offer.id} />
                    <label className="text-sm">
                      Precio (USD)
                      <Input
                        {...(update.error !== undefined &&
                        offerUpdateErrorId === offer.id
                          ? {
                              "aria-describedby": `service-catalog-offer-${offer.id}-error`,
                              "aria-invalid": true,
                            }
                          : {})}
                        className="mt-1"
                        defaultValue={offer.priceUsd}
                        disabled={!offer.active || !canManageOffers}
                        name="priceUsd"
                        pattern="[0-9]+\.[0-9]{2}"
                        required
                      />
                    </label>
                    <label className="text-sm">
                      Duración
                      <Input
                        {...(update.error !== undefined &&
                        offerUpdateErrorId === offer.id
                          ? {
                              "aria-describedby": `service-catalog-offer-${offer.id}-error`,
                              "aria-invalid": true,
                            }
                          : {})}
                        className="mt-1"
                        defaultValue={offer.durationMinutes}
                        disabled={!offer.active || !canManageOffers}
                        min="5"
                        name="durationMinutes"
                        required
                        step="5"
                        type="number"
                      />
                    </label>
                    <label className="text-sm">
                      Buffer
                      <Input
                        {...(update.error !== undefined &&
                        offerUpdateErrorId === offer.id
                          ? {
                              "aria-describedby": `service-catalog-offer-${offer.id}-error`,
                              "aria-invalid": true,
                            }
                          : {})}
                        className="mt-1"
                        defaultValue={offer.bufferMinutes}
                        disabled={!offer.active || !canManageOffers}
                        min="0"
                        name="bufferMinutes"
                        required
                        step="5"
                        type="number"
                      />
                    </label>
                    {canManageOffers ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={!offer.active || update.isPending}
                          type="submit"
                        >
                          Guardar
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!offer.active || deactivate.isPending}
                          onClick={() => setOfferToDeactivate(offer.id)}
                          type="button"
                        >
                          {offer.active ? "Desactivar" : "Desactivada"}
                        </Button>
                      </div>
                    ) : null}
                    {update.error !== undefined &&
                    offerUpdateErrorId === offer.id ? (
                      <FieldError
                        className="sm:col-span-4"
                        id={`service-catalog-offer-${offer.id}-error`}
                      >
                        {update.error?.message}
                      </FieldError>
                    ) : null}
                  </form>
                );
              })}
            </div>
          </article>
        ))}
      </div>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setOfferToDeactivate(undefined);
        }}
        open={offerToDeactivate !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogTitle>¿Desactivar esta Oferta?</AlertDialogTitle>
          <AlertDialogDescription>
            Las Citas existentes conservan su configuración. Las nuevas Opciones
            dejarán de usar esta Oferta; si la acción reduce capacidad, se
            mostrará el conflicto y no se aplicará parcialmente.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deactivate.isPending}
              onClick={() => {
                if (offerToDeactivate !== undefined) {
                  deactivate.mutate({ offerId: offerToDeactivate });
                }
              }}
            >
              {deactivate.isPending ? "Desactivando…" : "Desactivar Oferta"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !update.isPending) setOfferToUpdate(undefined);
        }}
        open={offerToUpdate !== undefined}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            ¿Confirmar actualización de Oferta?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {offerToUpdate !== undefined &&
            offerToUpdate.previous.durationMinutes +
              offerToUpdate.previous.bufferMinutes <
              offerToUpdate.input.durationMinutes +
                offerToUpdate.input.bufferMinutes
              ? `La nueva Oferta ocupará ${offerToUpdate.input.durationMinutes + offerToUpdate.input.bufferMinutes} minutos en las Opciones futuras, frente a ${offerToUpdate.previous.durationMinutes + offerToUpdate.previous.bufferMinutes} minutos actuales; esto puede reducir la capacidad disponible.`
              : "La nueva duración y buffer se usarán al recalcular Opciones futuras."}{" "}
            Las Citas confirmadas conservan la duración, buffer y precio
            cotizados al crearse; este cambio no las modifica.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={update.isPending}>
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={update.isPending || offerToUpdate === undefined}
              onClick={() => {
                if (offerToUpdate !== undefined) {
                  setOfferUpdateErrorId(offerToUpdate.input.offerId);
                  update.mutate(offerToUpdate.input);
                }
              }}
            >
              {update.isPending ? "Guardando…" : "Confirmar actualización"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
