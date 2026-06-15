# Datasets pertenecen al Área, no al Usuario

Los datasets son propiedad del Área, no del usuario que los sube. El usuario queda registrado como `uploadedBy` para auditoría, pero si el usuario sale de la organización, los datos permanecen. Decidimos contra ownership personal porque en BI empresarial los datos son activos del equipo: perder datasets por rotación de personal destruye la continuidad operativa.

## Considered Options

- **Dataset del usuario, compartible al área**: descartado porque invierte la lógica — en BI los datos son del negocio, no del analista.
